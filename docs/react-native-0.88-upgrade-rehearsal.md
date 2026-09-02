# React Native 0.88 upgrade rehearsal

Snapshot: 2026-08-27

## Scope and result

This was an isolated forward-compatibility canary against
`react-native@0.88.0-nightly-20260825-5a29c68af`. It does not add React Native
0.88 to the supported backend matrix. React Native 0.87.0 remains the only
device-verified release line in the repository.

The canary reached ordinary Release launches on a physical Pixel 9a and iPhone
17 Pro, plus a complete unsigned generic-device iOS Release build from a fresh
mainline snapshot. The Android application loaded generated TurboModules,
mounted and measured its Solid-owned Fabric tree, synchronized native focus,
and remained quiescent. The iOS build resolved 95 pods across 100 Xcode targets
and compiled, linked, bundled, signed, and validated the application, Fabric
host, generated view, TurboModules, screens, Nitro modules, camera, and Hermes
runtime. No behavioral Solid Native C++, Kotlin, Objective-C++, Codegen, or
Fabric-host implementation change was required. Two version-identity changes
were required to make the built application valid at runtime:

1. React Native's own `hermes-compiler` dependency had to replace an incorrect
   guessed compiler pin.
2. The package release identifier had to remain distinct from the normalized
   `0.88.0` version exposed by the native `PlatformConstants` registry.

The native boundary manifest now drives the exact CocoaPods constraints and
the expected C++ version tuple on both platforms. An isolated canary therefore
selects 0.88 in one reviewed native manifest instead of rewriting Podspecs,
CMake code, and a release-named C++ namespace. The result is encouraging
maintenance evidence, not a compatibility claim. A signed physical iOS launch
and the representative navigation, module, lifecycle, and benchmark gates
still need to run against a stable 0.88 release before that backend can be
promoted.

## Exact candidate

| Input                                    | Canary value                                       |
| ---------------------------------------- | -------------------------------------------------- |
| React Native package                     | `0.88.0-nightly-20260825-5a29c68af`                |
| React Native runtime identity            | `0.88.0`                                           |
| Hermes compiler required by React Native | `260318099.0.1`                                    |
| Hermes bytecode                          | HBC 99                                             |
| React                                    | `19.2.3`                                           |
| Metro transform worker                   | `0.87.0`                                           |
| Android device                           | Physical Pixel 9a, USB-connected and unlocked      |
| iOS device                               | Physical iPhone 17 Pro, USB-connected and unlocked |

The Metro package remained on 0.87 because the candidate React Native package
still depends on the Metro 0.87 line and no `metro-transform-worker@0.88.0`
release exists for this canary.

## Evidence obtained

- All JavaScript module paths imported by Solid Native remained present.
- All React Native C++ and Apple headers imported by the native runtime
  remained present.
- `pnpm build` passed for every workspace package and application.
- `pnpm check` passed, including TypeScript, syntax checks, generated Solid
  bindings, and the compatibility catalog.
- A fresh candidate created from mainline commit `3b3b54d` passed the read-only
  upgrade audit with 17 passes, 3 warnings, and 0 failures. All 32 imported
  native headers remained present; 10 changed and were surfaced for review.
- Android Release compiled and linked the application runtime, Fabric host,
  generated components and modules, `react-native-screens`, AsyncStorage,
  Notify Kit, Nitro Image, Nitro Modules, and VisionCamera.
- The complete Android Release assembly completed with 379 Gradle tasks.
- A freshly generated bundle reported HBC bytecode version 99 in its header.
- The Release APK installed and cold-launched on the Pixel.
- The checked-in ordinary-launch runner observed generated TurboModule schema,
  Solid/Fabric mount, measurement, native-focus synchronization, and quiescent
  readiness.
- CocoaPods resolved the exact nightly release and Hermes pair using React
  Native's prebuilt Core and Dependencies artifacts.
- An unsigned `generic/platform=iOS` Release build succeeded across the full
  100-target dependency graph with Xcode 26.6 and the iPhoneOS 26.5 SDK.
- A separately derived Release application compiled against the exact physical
  iPhone destination, embedded HBC 99, and was automatically signed under a
  collision-free `dev.solidnative.e2e.rn088canary` identity.
- The mainline device verifier matched its bundle metadata, code-signing
  identifier, and requested team, installed it on the iPhone 17 Pro, confirmed
  the exact launched process survived the bounded observation window, then
  terminated and uninstalled it. Independent postflight checks found neither
  the canary bundle nor any Solid Native application/test process on the phone.
- The emitted iOS Hermes source map passed the strict runtime gate: exactly one
  Solid reactive runtime and no reviewed React-facing platform facade.

The fresh candidate lockfile SHA-256 was
`e6d0db6b75aa3ffb6fa652906c57466be10dd0d5a5978fb94edbec22a5516aa5`.
This rehearsal did not run the complete repository CI gate or specialized
physical navigation and native-module suites against the candidate. The signed
proof is an ordinary launch-survival check, not behavioral parity or support
promotion.

## Failures that exposed upgrade contracts

### Hermes compiler/runtime mismatch

The first candidate used `hermes-compiler@250829098.0.17`, selected by looking
at the package's default release tag. Android compiled, linked, packaged, and
installed successfully, but the process aborted before application JavaScript
ran:

```text
Wrong bytecode version. Expected 99 but got 98
```

The candidate React Native manifest actually pins
`hermes-compiler@260318099.0.1`, which emits HBC 99. Selecting that exact pair
removed the abort. A successful native build therefore cannot prove that a
Hermes bundle is executable by its embedded VM.

The supported CLI now prevents this class of failure in two ways:

- `run`, `build`, `bundle`, and `start` planning require the installed direct
  compiler to equal the exact compiler dependency declared by the installed
  React Native package.
- `doctor` executes the application-local `hermesc -version`, verifies its
  release identity, and verifies the expected HBC format before native build
  tooling sees the bundle.

### Package release versus runtime identity

React Native's npm package identifies the canary with the complete nightly
version, while `PlatformConstants.reactNativeVersion` exposes only the
`0.88.0` major/minor/patch tuple. Treating both as one string caused the
Solid-owned native-module registry to reject an otherwise compatible runtime.

A production upgrade must preserve both identities explicitly:

- the exact package release belongs in dependency locks, fingerprints, build
  provenance, and the supported package matrix;
- the normalized runtime identity belongs in the live native-backend handshake.

## Native API drift observed

The imported paths survived, but several implementation files changed. The
upgrade review must account for at least these areas:

- `UIManager` added an `UmbrellaGuard`, changed several surface arguments to
  by-value forms, and added a `shadowTreeDidCommit` override;
- `ShadowTree` removed its previous `emitLayoutEvents` path;
- `RuntimeScheduler`, DOM bindings, `UIManagerBinding`, and
  `UIManagerMountHook` changed internally;
- Apple `RCTTurboModule` implementation details changed;
- `NativeEventEmitter` and keyboard JavaScript implementations changed.

These changes did not break the Android compile, but source presence alone is
not ABI or behavioral proof.

## Promotion work remaining

Before promoting a stable React Native 0.88 backend:

1. Repeat the rehearsal against the stable package and its exact lockfile.
2. Update package-release and normalized-runtime identities independently.
3. Repeat the successful CocoaPods, generic-device, and signed physical-iOS
   launch proof against the stable release.
4. Run the Android and iOS native stack/tab restoration suites, not only the
   ordinary mount path.
5. Run representative TurboModule, generated component, camera, notification,
   animation, lifecycle, reload, and teardown suites.
6. Rebuild matched performance and memory evidence rather than inheriting
   0.87 results.
7. Review every long-lived `react-native-screens` patch and upstream or rebase
   it explicitly.
8. Only then add a supported-backend entry and physical evidence fingerprints.

The canary shows that the Fabric seam is surviving current React Native work.
It also validates the repository's fail-closed approach: compiler, package,
runtime, and physical identities must remain separate and independently
checked.

## Repeatable audit workflow

The original rehearsal was assembled manually. The CLI now preserves its
reusable pre-build checks as an offline, non-mutating command:

```sh
solid-native upgrade react-native \
  --cwd path/to/verified-0.87-application \
  --candidate path/to/installed-candidate
```

The candidate path must point into a separate application or worktree whose
dependency lockfile has already been installed. The audit does not query npm or
change either tree. It checks the exact package/runtime/Hermes/React/Codegen/
Gradle identities, runs the candidate compiler to record its HBC format,
requires the candidate Fabric boundary to name the exact package release, and
hash-compares the React Native-owned headers named by that boundary. JSON
output retains lockfile fingerprints and classifies header additions,
removals, moves, content changes, ambiguities, and external native inputs.

Passing this audit is only permission to start the native qualification work.
Its report always leaves `promotionReady` false and enumerates the iOS,
Android, physical navigation, module/lifecycle, performance, and memory gates
that still have to produce reviewed evidence.
