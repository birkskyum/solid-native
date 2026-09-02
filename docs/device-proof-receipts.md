# Android device-proof receipts

Solid Native's Android device-proof receipt is a portable statement about one
fresh, passing run on physical hardware. The receipt itself is unsigned
evidence. `solid-native device-proof sign`, `signing-request`, and
`verify-signature` provide its separate device-lab trust domain; a receipt never
authorizes release delivery.

## Versions

Schema 0 is the retained legacy repository proof. It deliberately hardcodes
`dev.solidnative.e2e.SolidNativePhysicalTest#testPhysicalRendererUpdate` and the
four reviewed source-map checks used by `apps/native-e2e`. Existing receipts,
signatures, and version-0 trust policies remain valid. Its historical `bundle`
field contains source-map bytes, so schema 0 does not independently identify
the executed JavaScript bundle and cannot satisfy release correlation.

Schema 1 keeps the structure bounded and path-free, separates `bundle` from
`sourceMap`, and permits an application or lab to declare its own
instrumentation class, test method, and passing source-map policy. That
flexibility is fail-closed: a schema-1 receipt cannot produce
`authenticatedProof` unless its derived verification profile is explicitly
trusted.

The current retained Pixel proof uses schema 1. Schema 0 remains checked in to
guard backward-compatible parsing, signing, and ingestion only.

## Receipt contract

Both versions use `proof: "solid-native-android-release-device"`, require
`status: "passed"`, and contain only these top-level fields:

- `source`: a lowercase 7–64 character Git revision and dirty flag. Signing
  rejects a dirty receipt.
- `measuredAt`: canonical UTC time no earlier than the instrumentation report
  and no more than one hour later.
- `device`: physical-hardware assertion, SHA-256 pseudonymous serial and build
  identities, bounded manufacturer/model/product/ABI/OS values, SDK level, and
  captured battery/thermal/power state.
- `nativeCompatibility`: the reviewed platform fingerprint and input count.
- `generatedBindings`: exact generated Solid binding bytes plus file and
  manifest SHA-256 identities.
- schema 1 `bundle`: the exact production JavaScript byte count and SHA-256.
- `sourceMap`: the exact canonical source-map byte count and SHA-256, source
  count, and the source-policy checks described below. In legacy schema 0 only,
  this structure is stored under the historical `bundle` key.
- `artifacts`: exact application and instrumentation APK byte counts and
  SHA-256 digests.
- `instrumentation`: class, test method, positive bounded duration, canonical
  report time, and exact result/exit-code evidence digests.

All objects have exact keys. Strings, counts, files, policy arrays, durations,
and the receipt itself are bounded. Symlinks, special files, oversized input,
unknown fields, malformed digests, noncanonical timestamps, emulator receipts,
dirty source, and non-passing states fail before signing.

Schema-1 `sourceMap.checks` contain exactly `kind`, `matches`, and `pattern`, with
between 1 and 64 unique checks:

- `required-source` requires one exact `app:///` identity and `matches: 1`.
- `forbidden-fragment` requires `matches: 0`.

At least one exact `required-source` check is mandatory.

Patterns are bounded and cannot contain control characters. Required portable
source identities cannot use backslashes or parent-directory segments. These
are the path-free passing results of the existing `solid-native bundle sources`
gate, not arbitrary labels supplied after a test.

## Verification profiles

A verification profile identifies exactly what the physical run proved. Its
fingerprint is SHA-256 over this canonical JSON payload:

```json
{
  "schemaVersion": 0,
  "kind": "solid-native.android-device-proof-profile",
  "proof": "solid-native-android-release-device",
  "instrumentation": {
    "className": "com.example.product.SolidNativeReleaseTest",
    "testName": "testProductionRenderer"
  },
  "sourcePolicy": [
    {
      "kind": "forbidden-fragment",
      "matches": 0,
      "pattern": "/node_modules/react/"
    },
    {
      "kind": "required-source",
      "matches": 1,
      "pattern": "app:///src/physical-device-test.tsx"
    }
  ]
}
```

Source checks are normalized by kind and pattern before hashing, so their input
order is not policy identity. The instrumentation identity and every check are
covered. Renaming the test, replacing it with a trivial test, adding or removing
a required source, or weakening a forbidden-fragment gate changes the profile.

Inspect the exact normalized profile before trusting it:

```sh
solid-native device-proof profile android-device-proof.json --json
```

Pinned-key verification accepts `--profile-fingerprint sha256:...`. A
version-1 trust policy carries the profile with its project, key lifecycle, and
monotonic sequence:

```json
{
  "schemaVersion": 1,
  "policySequence": 8,
  "projectName": "example-product",
  "proof": "solid-native-android-release-device",
  "profileFingerprint": "sha256:PROFILE_DIGEST",
  "keys": [
    {
      "keyId": "device-lab-2026-08",
      "algorithm": "ed25519",
      "publicKeySpki": "CANONICAL_UNPADDED_BASE64URL_SPKI",
      "status": "active"
    }
  ]
}
```

The placeholders above are explanatory and intentionally not valid key or
digest material. Use the profile command's exact output and a canonical Ed25519
SPKI value. A version-0 trust policy admits only the fixed legacy schema-0
profile unless the caller also supplies an explicit profile fingerprint. A
version-1 policy makes that profile constraint durable and is the recommended
portable configuration.

Successful `authenticatedProof` records the receipt schema and actual profile
fingerprint. The ingestion handoff also retains the normalized verification
policy that admitted it.

## Producer workflow

An application or independent device lab can produce schema 1 with the local
toolchain:

1. Start from a clean, immutable source revision and a reviewed compatibility
   fingerprint.
2. Build the production bundle, application APK, instrumentation APK, and
   generated bindings; record the exact JavaScript bundle and source map as
   distinct byte and SHA-256 identities.
3. Run exactly the declared instrumentation test on physical hardware and
   retain its fresh result and exit-code evidence.
4. Run the declared source-map requirements and forbidden-fragment checks over
   the exact production bundle inputs.
5. Collect device and power facts without placing local paths or a raw device
   serial in the receipt.
6. Atomically write the strict schema-1 receipt, inspect its profile, and have a
   governed lab key sign the exact receipt bytes.
7. Verify with a pinned profile or version-1 trust policy. For release health,
   use `release correlate-device-proof` so the authorized release derives the
   required revision, native fingerprint, and APK and the handoff also matches
   both the exact production JavaScript bundle and canonical source map.

`solid-native device-proof create-android` is the reusable implementation of
this workflow. Callers supply the exact bundle, map, APKs, generated binding,
Gradle result directory, instrumentation identity, source requirements, device
serial, and canonical pre-test timestamp. The command independently rejects
emulators and unavailable devices, rechecks clean Git revision/state, requires
one fresh passing XML result and zero exit code, evaluates the source map,
double-hashes build artifacts across live device collection, rereads the test
result and exit code, recomputes native compatibility, pseudonymizes device
identities, and publishes through a no-clobber atomic link. It emits the receipt
digest and deterministic profile needed by the separate signing step.

Correctly shaped JSON alone is not proof that those controls ran. Device labs
can wrap the producer with device allocation and key custody while keeping
the evidence contract independently inspectable.

## Non-claims

Receipt time is the lab-signed device/test time, not an independently trusted
timestamp. Policy files are trusted only when delivered through an external
governance channel, and the CLI does not persist sequence high-water marks.
Backends still own replay state, policy distribution, key custody, trusted
time, retention, access control, and alerts. Schema 1 currently covers Android;
iOS receipt parity remains separate work.
