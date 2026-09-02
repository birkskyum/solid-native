# Release envelopes

`solid-native release create` binds the open local evidence for one native
release into a deterministic unsigned envelope:

- the verified production bundle fingerprint;
- the selected platform's native compatibility fingerprint and exact runtime
  versions;
- a caller-supplied source revision, application release, and channel;
- the final APK, AAB, IPA, or other regular-file artifact's name, byte count,
  and SHA-256 digest;
- for a production Android AAB, its verified public upload-certificate SHA-256;
- for a directly distributed Android APK, its exact bounded signing-certificate
  SHA-256 set across the supported Android-version range.

```sh
solid-native release create \
  --bundle android/app/build/solid-native-bundle/solid-native-bundle.json \
  --artifact android/app/build/outputs/bundle/release/app-release.aab \
  --release 1.4.0+42 \
  --channel production \
  --revision 0123456789abcdef0123456789abcdef01234567 \
  --android-upload-certificate-sha256 "$ANDROID_UPLOAD_CERTIFICATE_SHA256"
```

The default output is `solid-native-release.json` beside the bundle manifest.
Use `--output` to select another existing directory and `--json` to emit the
result plus its local path for automation.

Supplying `--android-upload-certificate-sha256` runs strict JDK JAR-signature
verification before writing the envelope, rejects unsigned, partially signed,
multiply signed, or Android-Debug-signed bundles, pins the expected leaf
certificate, and binds that public identity as `artifactSigning`. Release
creation rehashes the AAB after inspection so the certificate and artifact
digest cannot be joined across different bytes. No keystore or credential is
read. Each JDK subprocess is bounded to 30 seconds and 256 KiB of combined
retained output; timeout or truncation fails closed. Inspection copies the AAB
to a private immutable snapshot, so it temporarily needs roughly the artifact's
size in free disk space; the snapshot is removed afterward.

For an APK, repeat `--android-signing-certificate-sha256` for every expected
certificate:

```sh
solid-native release create \
  --bundle android/app/build/solid-native-bundle/solid-native-bundle.json \
  --artifact android/app/build/outputs/apk/release/app-release.apk \
  --release 1.4.0+42 \
  --channel production \
  --revision 0123456789abcdef0123456789abcdef01234567 \
  --android-signing-certificate-sha256 "$ANDROID_SIGNING_CERTIFICATE_SHA256"
```

The newest stable `apksigner` beneath the configured Android SDK verifies the
APK for all platform versions declared as supported by its manifest, with
warnings treated as failures. The envelope binds the complete sorted
certificate set rather than guessing one current key, so a version-targeted
APK signing-key rotation remains explicit. Debug certificates, missing or
unexpected co-signers, noncanonical sets, timeout, and truncated output fail
closed. The same immutable-snapshot and temporary-disk rules apply.

The schema-version-0 envelope uses SHA-256 and derives `releaseFingerprint`
from canonical JSON containing all fields except the fingerprint itself. It
contains no checkout or artifact absolute paths. Release identifiers and
channels are bounded tokens, source revisions are canonical lowercase hex, the
final artifact must be a stable regular file no larger than 8 GiB, and all
input manifests retain their own scan and size limits. Bundle verification also
requires the digest-matching source map to remain canonical and self-contained:
every bounded source has embedded content, indexed sections are inline and
ordered, and no local path or source-root ambiguity survives. Signing therefore
binds a usable symbolication artifact rather than an arbitrary hashed JSON file.

## Bundle-to-archive linkage

Hashing an APK and an independently produced JavaScript bundle in the same
envelope does not prove that the archive contains code compiled from that
bundle. For the stronger path, first emit the exact non-minified Hermes source
shape used by React Native 0.87's Release task:

```sh
solid-native bundle android --hermes-source \
  --output android/app/build/solid-native-hermes-source

solid-native bundle ios --hermes-source \
  --output ios/build/solid-native-hermes-source
```

For Android, the source-map basename and terminal source-map reference
intentionally match the upstream Gradle packager. The iOS map remains a
canonical audit artifact; its local path does not affect the Hermes comparison.
Then ask release creation to inspect the final archive:

```sh
solid-native release create \
  --bundle android/app/build/solid-native-hermes-source/solid-native-bundle.json \
  --artifact android/app/build/outputs/apk/release/app-release.apk \
  --release 1.4.0+42 \
  --channel production \
  --revision 0123456789abcdef0123456789abcdef01234567 \
  --inspect-embedded-bundle
```

The bounded ZIP reader accepts the standard APK
`assets/index.android.bundle`, AAB `base/assets/index.android.bundle`, or
top-level IPA `Payload/<name>.app/main.jsbundle` entry. It requires exactly one
unencrypted stored/deflated candidate, validates its ZIP size and CRC, and
checks the Hermes magic, device-verified bytecode version, and internal file
checksum. It then recompiles an immutable snapshot of the reviewed source with
the application-local pinned Hermes compiler and React Native's Release flags.
Creation fails unless both the Hermes source hash and complete bytecode SHA-256
match the archived bytes.

Android bytecode compares directly. iOS builds that set Xcode's
`SOURCEMAP_FILE` also compare directly because Hermes omits the local input
filename. Without that setting, Hermes records Xcode's absolute intermediate
`main.jsbundle` path as a length-prefixed debug filename. The verifier compiles
from a same-length synthetic filename, replaces only that compiler-generated
slot with the archived filename, recomputes Hermes's trailing checksum, and
then requires full SHA-256 equality. The absolute path is never opened, trusted,
or recorded in the release envelope. Any other byte difference still fails.

The envelope records the internal archive path, bytecode version, byte count,
SHA-256, and Hermes source SHA-1. The SHA-1 is diagnostic metadata from the
Hermes header; trust rests on the exact compiled-bytecode SHA-256, the bundle
manifest's SHA-256, and the signed release envelope. Verification repeats the
archive parsing and compilation. Bounded single-disk ZIP64 uses the same entry,
directory, artifact, and embedded-bundle limits. Multi-disk, encrypted,
oversized, duplicate, wrong-version, or mismatched archives fail closed.

This proof targets the standard React Native 0.87 Android and top-level iOS
application packaging contracts. Nested watch applications and multi-disk
archives remain outside the claimed contract.

## Independent verification

Verification requires the envelope, its bundle manifest, the final artifact,
and the application checkout whose native inputs were fingerprinted:

```sh
solid-native release verify solid-native-release.json \
  --bundle android/app/build/solid-native-bundle/solid-native-bundle.json \
  --artifact android/app/build/outputs/bundle/release/app-release.aab \
  --json
```

The read-only report checks the canonical envelope fingerprint, final artifact
bytes, any envelope-bound Android signature and upload certificate, any
declared embedded native Hermes linkage, the complete verified bundle artifact
set, and the current native compatibility inputs. Integrity mismatches return
status 1. Malformed or unsafe input returns status 2.

## Trust boundary

The envelope deliberately declares `trust: "unsigned"`. Its integrity checks
detect accidental corruption and inconsistent inputs, but anyone can replace
an artifact and recompute every local hash. They also cannot prove that the
named source revision produced the supplied binary.

A trusted delivery pipeline can add a detached Ed25519 attestation without
giving Solid Native custody of its signing key. Managed or hardware-backed
signers can emit the same small statement outside this CLI. For its file-based
flow, generate and retain the key through the pipeline's secret manager; a local
OpenSSL example is shown only to make that contract concrete:

Release and physical-device statements are not interchangeable. Device-proof
signatures use a separate contextual payload and authenticate test evidence;
only the release signature and authorization policy described here can produce
`authorizedRelease` delivery lineage.

```sh
umask 077
openssl genpkey -algorithm Ed25519 -out release-private.pem
openssl pkey -in release-private.pem -pubout -out release-public.pem

solid-native release sign solid-native-release.json \
  --key release-private.pem \
  --key-id production-2026-08 \
  --bundle android/app/build/solid-native-hermes-source/solid-native-bundle.json \
  --artifact android/app/build/outputs/apk/release/app-release.apk
```

With both release inputs supplied, the signer independently verifies the final
artifact, bundle set, embedded Hermes linkage, and current native compatibility
before reading the private key. Either supply both `--bundle` and `--artifact`
or neither; omitting both is the explicit envelope-only mode for an isolated
signer that receives no build outputs. The signer also rejects an envelope
whose canonical fingerprint is invalid or changes while being signed,
non-Ed25519 keys, symlinked or oversized key files, unsafe key identifiers, and
on POSIX systems a private key accessible to group or other users. The private
key path and bytes never enter the detached statement. Ed25519 produces the same
signature for the same envelope and key, so repeated signing is inspectable.

For a signer whose private key must never enter the CLI process, prepare the
same canonical contextual payload separately:

```sh
solid-native release signing-request solid-native-release.json \
  --key-id production-2026-08 \
  --bundle android/app/build/solid-native-hermes-source/solid-native-bundle.json \
  --artifact android/app/build/outputs/apk/release/app-release.apk \
  --output solid-native-release.signing-request.json \
  --json
```

The request contains the statement identity, its exact unpadded-base64url
payload, and the decoded payload's SHA-256. A KMS, HSM, or offline signer must
base64url-decode `payloadBase64url` and Ed25519-sign those exact bytes. Return
either the 64 raw signature bytes or their canonical unpadded base64url text,
then assemble the ordinary detached statement:

```sh
solid-native release assemble-signature \
  solid-native-release.signing-request.json \
  --signature release-signature.bin \
  --public-key release-public.pem \
  --output solid-native-release.json.sig.json \
  --json
```

Assembly verifies the external signature against the supplied Ed25519 public
key before writing anything and never accepts or reads a private-key path. A
request with changed statement, payload, digest, unknown field, or noncanonical
encoding fails closed. The request itself is an unsigned signing instruction,
not provenance: the signer or surrounding trusted workflow must decide which
verified build is authorized. Paired request creation verifies the same release
inputs as direct signing, while envelope-only request creation intentionally
produces the same payload without claiming that proof.

For an Android App Bundle, the preferred path is the
`--android-upload-certificate-sha256` release-creation gate above. To inspect an
AAB independently without creating an envelope, run:

```sh
solid-native release verify-android-signing \
  android/app/build/outputs/bundle/release/app-release.aab \
  --expected-certificate-sha256 "$ANDROID_UPLOAD_CERTIFICATE_SHA256" \
  --json
```

The standalone command applies the same strict JDK verification and policy. A
gated release envelope stores both its reported artifact SHA-256 and the public
upload-certificate identity, and independent `release verify` repeats the proof
automatically. This local proof does not establish Play acceptance and is
distinct from the app-signing certificate Google may use for delivered APKs.

The same command auto-selects Android SDK `apksigner` for an APK. Repeat the
expected-certificate flag when a reviewed key rotation produces more than one
valid signer across supported Android versions:

```sh
solid-native release verify-android-signing \
  android/app/build/outputs/apk/release/app-release.apk \
  --expected-certificate-sha256 "$ANDROID_SIGNING_CERTIFICATE_SHA256" \
  --json
```

Pin the corresponding public key and expected key ID through a separate trusted
configuration path, then verify the detached statement:

```sh
solid-native release verify-signature solid-native-release.json.sig.json \
  --manifest solid-native-release.json \
  --public-key release-public.pem \
  --key-id production-2026-08 \
  --project example-mobile \
  --platform android \
  --channel production \
  --bundle android/app/build/solid-native-hermes-source/solid-native-bundle.json \
  --artifact android/app/build/outputs/apk/release/app-release.apk \
  --json
```

For repeatable rotation and revocation, replace the individual key and scope
flags with a separately trusted policy file:

```json
{
  "schemaVersion": 0,
  "policySequence": 7,
  "projectName": "example-mobile",
  "platform": "android",
  "channel": "production",
  "keys": [
    {
      "keyId": "production-2026-08",
      "algorithm": "ed25519",
      "publicKeySpki": "<unpadded-base64url-SPKI-DER>",
      "status": "active"
    }
  ]
}
```

`publicKeySpki` is the canonical Ed25519 SubjectPublicKeyInfo DER encoded as
unpadded base64url. One way to derive it from the PEM above is:

```sh
openssl pkey -pubin -in release-public.pem -outform DER |
  openssl base64 -A |
  tr '+/' '-_' |
  tr -d '='
```

Then verify through that single trust input:

```sh
solid-native release verify-signature solid-native-release.json.sig.json \
  --manifest solid-native-release.json \
  --trust-policy production-android-trust.json \
  --minimum-policy-sequence 7 \
  --bundle android/app/build/solid-native-hermes-source/solid-native-bundle.json \
  --artifact android/app/build/outputs/apk/release/app-release.apk \
  --json
```

The policy accepts 1–32 unique keys and requires a positive safe-integer
`policySequence`. Add a new `active` key and increment the sequence before
switching the signer; after the new policy is deployed through a trusted path,
a former key can remain listed as `revoked` under another incremented sequence.
A signature from that key can still pass the cryptographic check, but the
policy check fails and `authorizedRelease` is omitted. The verifier sorts keys
by ID before hashing the normalized policy and emits its deterministic
`trustPolicyFingerprint` plus sequence in both the report and successful
authorized lineage. `--minimum-policy-sequence` rejects a structurally valid
older policy before authorization. Unknown fields, duplicate IDs or key
material, non-Ed25519 keys, malformed SPKI, and unknown signed key IDs fail
closed. The optional release, revision, envelope, bundle, native, and artifact
pins supported by individual flags are also valid top-level policy fields.

The policy is a trust root, not a self-authenticating artifact. Solid Native
does not download it, decide which copy is current, or preserve deployment
history. A production system must distribute it through an independently
trusted channel and persist the highest accepted sequence or exact fingerprint
before supplying the minimum on a later verification.

The in-process report includes a frozen `authorizedRelease` lineage—and JSON
output includes the same fields—only when the envelope, key identity, Ed25519
signature, every policy pin, and any requested input proof pass. It is built
from the same canonical manifest snapshot used for verification; downstream
delivery or telemetry code does not need to reopen the unsigned file. Failed
reports omit it. With the paired build inputs above, the command also repeats
`release verify`, binds that report to the same manifest fingerprint, and sets
`authorizedRelease.inputsVerified` to `true`. A changed artifact or bundle
therefore prevents authorization.

An isolated verifier that intentionally receives only the signed statement can
use `--envelope-only`; omission is not implicit. A passing envelope-only report
sets `inputsVerified` to `false`, so a downstream production gate or telemetry
bootstrap can reject weaker evidence explicitly.

Verification rejects an altered canonical envelope, unexpected authenticated
key ID, signature from any other key, or an envelope outside the separately
trusted project/platform/channel scope. Optional `--release`, `--revision`,
`--release-fingerprint`, `--bundle-fingerprint`, `--native-fingerprint`, and
`--artifact-sha256` pins narrow that authorization to a known delivery. Unknown
schema-v0 fields and unknown policy fields are rejected instead of being
interpreted differently by downstream consumers.

A valid envelope-only signature says that the pinned key attested to this
release fingerprint and that the envelope matches the supplied authorization
policy. It does not prove the claimed revision produced the binary unless the
key's policy requires a clean build plus `release verify` before signing.
Supplying verification inputs proves the supplied bytes match the signed
identity, but the trusted build policy is still what connects those bytes to
the claimed source. Stable scope pins also do not by themselves prevent
rollback to an older correctly signed release; pin the expected release,
revision, or exact release fingerprint and maintain a monotonic deployment
policy where rollback is forbidden.

A production pipeline must still bind store identity and final platform
metadata, protect keys, distribute the current trust policy, retain an audit
log, and prevent unauthorized policy or release rollback. Runtime update
authorization and production telemetry should accept only that policy-verified
identity—not the unsigned local file, an arbitrary self-signed key, or an
untrusted policy path.

After that policy check, an application passes the verifier's complete
`authorizedRelease` object to the causal telemetry session. Solid Native
requires input-complete evidence and stamps its project, platform, release,
channel, source revision, release/bundle/native/artifact fingerprints,
authenticated key ID, and optional trust-policy identity onto every causal
owner, event, commit, mount, and frame record. Supplying the unit as one
fail-closed input avoids a second, manually assembled release identity without
making the runtime its own trust authority.

## Symbolication handoff

`solid-native release symbolication` applies that same input-complete verifier
to observability artifacts. It refuses envelope-only authorization, repeats the
bundle proof at the handoff boundary, and returns the exact generated bundle
and canonical self-contained source map with their signed byte counts and
SHA-256 digests. Its `authorizedRelease` is the same frozen object accepted by
the causal telemetry session, so a backend can correlate symbols and runtime
records without reconstructing project, platform, channel, revision, signer,
or release identity from unsigned files.

The schema is vendor-neutral and the CLI performs no upload. Absolute local
paths are explicitly operational inputs rather than fingerprint material; an
adapter must check the declared size and digest immediately before transport.
Persisted trust still comes from the signed release and independently delivered
policy, not from a serialized handoff-shaped object.

## Physical-device correlation

For Android, `solid-native release correlate-device-proof` joins this
input-complete release authorization to an independently signed physical-device
receipt. Both signatures are checked under separate versioned policies. The
correlator derives the required source revision, native-compatibility
fingerprint, and final APK digest from `authorizedRelease`, passes them back
through the device-proof verifier, and separately requires the project
identities to match. Callers cannot replace those release-derived constraints.
It then repeats the release bundle-manifest proof and requires the signed device
receipt's JavaScript bundle size and SHA-256 to match that exact production
bundle.

The result is path-free and carries both original verifier lineages. It proves
that one trusted lab statement exercised the exact authorized Android artifact
and JavaScript bundle; it does not let a lab key authorize release delivery. Optional receipt and
measurement-window constraints can narrow replay policy, while independently
trusted timestamps and durable high-water state remain control-plane concerns.
