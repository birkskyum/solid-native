# **PROJECT_NAME**

**APP_TITLE** is a Solid Native application backed by the version-pinned React
Native 0.87 Fabric runtime. Solid owns the application component tree; React is
present only as a native backend dependency.

## First run and first edit

Validate the generated project before paying for a native build:

```sh
pnpm run doctor
pnpm check
pnpm test
```

Start Metro in one terminal:

```sh
pnpm start
```

With an authorized, unlocked phone attached, launch the application from a
second terminal:

```sh
pnpm android
# or
pnpm ios
```

Install the iOS pods first with the commands below. For a deterministic Android
launch, pass the exact adb serial after `--`, for example
`pnpm android -- --device DEVICE_SERIAL`. Solid Native verifies that target
before Gradle starts. A physical device must be unlocked; the CLI owns a
reversible USB/AC stay-awake lease for the native command and restores the prior
setting on success or failure. Concurrent local runs cannot lease the same
serial, and a later run recovers a valid lease left by an abruptly killed CLI.
Emulators receive availability checks without power-setting changes. Plain
`pnpm android` applies this contract when exactly one authorized target is
attached and passes that validated serial explicitly to React Native; with
several, select one explicitly or use
`pnpm android -- --list-devices` for React Native's interactive picker.

When more than one iOS destination is available, pass the ordinary React Native
CLI device option after `--`, for example
`pnpm ios -- --device CORE_DEVICE_ID`. Explicit physical iOS targets must be
currently unlocked; the Solid Native CLI checks CoreDevice before starting
Metro, CocoaPods, or Xcode. Simulator runs are unchanged.

Edit `src/App.tsx` to make the first application change. Solid signal reads in
TSX update only their dependent native output; the application is not rendered
through React or a WebView. Source changes currently perform a safe
whole-runtime reload, so mounted Solid owners and native resources cannot
survive stale code.

The starter screen includes a bounded animation authored from typed named
inputs. `createNativeViewAnimation` waits for its Fabric ref to mount, then
drives the card on Android `Choreographer` or iOS `CADisplayLink` without a
JavaScript frame loop. Its Solid owner releases the graph automatically.

## Development

```sh
pnpm run doctor
pnpm test
pnpm fingerprint
pnpm generate
pnpm start
pnpm android
pnpm ios
pnpm build:android
pnpm build:ios
pnpm bundle:android
pnpm bundle:ios
pnpm release -- --help
```

`pnpm test` runs the generated `test/App.test.tsx` against the deterministic
Solid Native host. It compiles application TSX with the same Solid universal
OXC pipeline as Metro and uses Node's built-in test runner with Solid's
development diagnostics enabled; it does not start React, Jest, Metro, a
simulator, or a device. The starter test presses the real `App` component's
counter, observes its fine-grained native text mutation, and drives a delayed
response and chunk through the app's real Solid-owned native network controller
before requiring complete owner and surface cleanup. It rejects Solid
diagnostics, wasted computations, rerun-budget regressions, and excess native
commits or mutations. Use `pnpm test -- --production` for an explicit optimized-
runtime pass of the same behavior; Solid does not expose diagnostic channels in
that mode. Keep
physical-device tests for Fabric, Yoga, operating-system UI, and performance
claims.
Call `screen.debug()` in a test to return a bounded readable native tree;
`screen.debug({ includeProps: true })` also includes deterministic transport
props when a component boundary needs deeper inspection.
Use `await screen.findByText("Loaded")` (or another `findBy*` query) for delayed
native service or stream output; use `screen.waitFor` for a custom synchronous
assertion. Polling is bounded and abortable, and timeout errors include both the
last failed assertion and the committed native tree.
Capture `screen.commitCheckpoint()` before an action when transaction shape is
part of the contract, then use `getCommit` or `getMutation` with
`afterSequence`. These typed structural queries keep text, prop values, and
command arguments out of their bounded failure diagnostics.
Use `pnpm test -- --watch` for dependency-aware reruns and add
`--test-name-pattern "counter"` to focus matching test names.
For retained screens or repeated labels, scope the full query set with
`screen.within(screen.getByTestId("screen-id"))`; stale and cross-render roots
fail instead of matching a sibling native subtree.

The development entrypoint enables a bounded causal timeline on Android and iOS
debug builds. It also resolves `DevelopmentRoot` to a Solid-owned native error
overlay that catches render failures and guarded non-fatal Hermes exceptions.
Release bundles resolve the same import to a pass-through root and do not load
the controller, overlay, or global error bridge. Capture one live snapshot from
an attached device without starting a resident relay:

```sh
pnpm exec solid-native debug capture-android __ANDROID_PACKAGE__ --serial DEVICE_SERIAL \
  | pnpm exec solid-native debug inspect -
pnpm exec solid-native debug capture-android __ANDROID_PACKAGE__ --serial DEVICE_SERIAL \
  | pnpm exec solid-native debug trace - > causal-trace.json
pnpm exec solid-native debug capture-android __ANDROID_PACKAGE__ --serial DEVICE_SERIAL \
  | pnpm exec solid-native debug report - --output causal-report.html
pnpm exec solid-native debug capture-ios __IOS_BUNDLE_ID__ --device CORE_DEVICE_ID \
  | pnpm exec solid-native debug inspect -
pnpm exec solid-native debug capture-ios __IOS_BUNDLE_ID__ --device CORE_DEVICE_ID \
  | pnpm exec solid-native debug trace - > causal-trace.json
pnpm exec solid-native debug capture-ios __IOS_BUNDLE_ID__ --device CORE_DEVICE_ID \
  | pnpm exec solid-native debug report - --output causal-report.html
pnpm exec solid-native debug watch-android __ANDROID_PACKAGE__ --serial DEVICE_SERIAL
pnpm exec solid-native debug watch-ios __IOS_BUNDLE_ID__ --device CORE_DEVICE_ID
pnpm exec solid-native debug diagnostics-android __ANDROID_PACKAGE__ --serial DEVICE_SERIAL \
  --duration 1000 > solid-diagnostics.json
pnpm exec solid-native debug diagnostics-ios __IOS_BUNDLE_ID__ --device CORE_DEVICE_ID \
  --duration 1000 > solid-diagnostics.json
pnpm exec solid-native debug report-android __ANDROID_PACKAGE__ --serial DEVICE_SERIAL \
  --duration 1000 --output causal-report.html
pnpm exec solid-native debug report-ios __IOS_BUNDLE_ID__ --device CORE_DEVICE_ID \
  --duration 1000 --output causal-report.html
pnpm exec solid-native debug diagnostics-inspect solid-diagnostics.json
```

The Android and iOS diagnostics commands open one exclusive timed window in
the development Solid runtime and return only bounded diagnostic codes, static
computation names, dependency changes, rerun causes, and aggregate costs. They
never export reactive values, messages, stacks, owner IDs, component props,
text, or rendered content. The production resolver substitutes an inert shim,
so optimized bundles do not retain the capture controller.
Use `debug diagnostics-inspect solid-diagnostics.json` for a path-free summary
of diagnostic codes, rerun outcomes, retained causes, and ranked cost totals.

The starter's **Check native network** button uses the direct Solid Native
transport with a bounded response and owner-safe cancellation. Development
builds show those requests in the local native network badge; the same source
resolves to the uninstrumented `NetworkService` in production. The inspector
does not retain request headers, bodies, response text, or error messages.

Development builds also expose a native **Trace** badge backed by the same
bounded causal timeline used by capture commands. Opening it takes a manual
snapshot of retained operations; selecting one shows its transitive causes and
effects, and `Refresh` deliberately takes the next snapshot. The viewer does
not subscribe to its own Fabric telemetry, which prevents the inspector's
render commits from creating a self-observation loop. Release builds ignore the
development-root timeline prop and skip timeline allocation.

The generated development entry shares one Solid diagnostics controller with
the device transport and this inspector. Open **Trace**, choose **Capture
Solid**, exercise the application, and press **Stop Solid**. The reopened panel
shows bounded named rerun totals alongside same-window native frame-chain
counts. It does not render values or cause names and labels the association as
non-exact until Solid exposes a per-rerun correlation identity. Release builds
resolve both the root and diagnostics controller to inert shims.

If the native host, JSI binding, or initial Fabric surface cannot start, the
platform shell replaces the blank container with a dependency-free accessible
failure view. Debug builds include one bounded local diagnostic; production
builds expose only a generic message. After startup, fatal Hermes errors and
terminal Fabric commit failures cross the same bounded native handoff: the
shell stops Fabric-owned work and replaces the surface instead of leaving a
live blank tree. Only the error name and message cross; stacks and arbitrary
thrown values remain in JavaScript. `startNativeApplication` owns the global
fatal handler and restores its predecessor after failed startup or explicit
application disposal. Non-fatal development errors still belong to the
recoverable Solid overlay.

The trace artifact opens directly in Perfetto. The report is a self-contained
offline debugger with search and causal navigation. Release/store builds leave
the native request transport inactive and skip timeline allocation.

The `build:*` scripts create non-launching Release builds by default. Pass
native React Native CLI options after `--` to select a scheme, Gradle task, or
another configuration explicitly.

Android `doctor`, `run`, and `build` commands preserve an explicit `JAVA_HOME`.
If it is unset, they discover Android Studio's bundled JBR and use that same JDK
for both diagnostics and Gradle. This lets a current Android Studio toolchain
work even when the login shell still resolves an older Java. Use
`pnpm build:android -- --dry-run` to inspect the resolved `JAVA_HOME` without
starting a build.

`pnpm fingerprint` emits deterministic per-platform compatibility identities
for the runtime, dependency locks, compiler/bootstrap, and native project. The
local result is intentionally unsigned; sign it in the delivery pipeline before
attaching it to trusted runtime or update metadata.

`pnpm generate` runs the pinned React Native Codegen into the ignored,
isolated `build/solid-native-codegen` tree. Keeping this separate from Gradle's
application Codegen directory prevents dependency implementations discovered
by the upstream app generator from being linked twice beside their autolinked
libraries. Generation is staged transactionally: failures retain the previous
native and Solid outputs, while successful runs replace the complete native
tree so removed schemas cannot leave stale sources behind.

`pnpm start` verifies the installed Solid runtime, OXC/Metro compiler, and
application bootstrap before starting Metro. Stopping the command also stops
its worker process group so the development server does not linger.
Application source edits deliberately trigger a complete runtime reload:
React Refresh cannot safely replace mounted Solid owners. Owner-preserving
Solid HMR is not claimed by this template yet.

The `bundle:*` scripts write minified production JavaScript, copied assets,
portable composed source maps, and a deterministic unsigned SHA-256 manifest
beneath the selected platform's ignored native build directory unless
`--output` selects an explicit artifact directory.
Verify the complete unsigned artifact set before handing it to a signing or
symbolication pipeline:

```sh
pnpm exec solid-native bundle verify ios/build/solid-native-bundle/solid-native-bundle.json
```

For an Android release envelope that proves which reviewed source produced the
Hermes bytecode inside its APK or AAB, generate the packaging-shaped source and
enable archive inspection during release creation:

```sh
pnpm bundle:android -- --hermes-source
pnpm release -- create \
  --bundle android/app/build/solid-native-bundle/solid-native-bundle.json \
  --artifact android/app/build/outputs/bundle/release/app-release.aab \
  --release 1.0.0+1 --channel production --revision "$GIT_REVISION" \
  --inspect-embedded-bundle \
  --android-upload-certificate-sha256 "$ANDROID_UPLOAD_CERTIFICATE_SHA256"
```

The ordinary `pnpm build:android` command delegates to React Native 0.87's
Release `bundle` task and writes that AAB path. Pass an explicit Gradle task
such as `--tasks assembleRelease` only when an APK is intentionally required,
then select the corresponding artifact path yourself. For that APK path, replace
the AAB upload-certificate option above with one or more
`--android-signing-certificate-sha256` options naming its complete expected
signer set.

The generated Android project initially reuses the debug keystore for its
Release build so a local AAB can be produced without private credentials. That
artifact is development-signed and must not be uploaded to Play. Before a store
release, define an application-owned non-debug `signingConfigs` entry, inject
its keystore path and credentials from protected local or CI configuration,
assign it to `buildTypes.release`, and use Play App Signing. Never commit the
keystore or its credentials. `pnpm run doctor --platform android` warns while
the debug signing fallback remains and recognizes an explicit non-debug config;
the delivery pipeline must still prove that the key is available and accepted.
Use `pnpm run doctor --platform android --strict` as a release-CI gate so any
remaining warning or required-check failure exits nonzero.

After configuring release signing, inspect the produced bytes independently at
any time with:

```sh
pnpm exec solid-native release verify-android-signing \
  android/app/build/outputs/bundle/release/app-release.aab \
  --expected-certificate-sha256 "$ANDROID_UPLOAD_CERTIFICATE_SHA256"
```

This reads no keystore or credentials. It rejects unsigned, partially or
multiply signed, and Android-Debug-signed AABs. The production `release create`
example above passes the same public fingerprint as a mandatory gate, records
it beside the exact AAB digest, and makes `release verify` repeat the proof. It
does not claim that Play accepted or re-signed the bundle.

The command also accepts an APK and then uses the newest stable Android SDK
`apksigner`. It verifies every Android version declared as supported by the
APK's manifest, rejects warnings and debug signers, and preserves a bounded
version-targeted key-rotation set. Repeat `--expected-certificate-sha256` for
every expected certificate. A release envelope records that exact set when its
creation command receives the matching repeated
`--android-signing-certificate-sha256` values.

Supply `GIT_REVISION` from a clean trusted build checkout. The resulting
envelope remains unsigned until the delivery pipeline attests it.
After signing, `solid-native release symbolication` can verify the signature,
policy, bundle, and final native artifact together and emit the exact local
bundle/source-map pair under the same `authorizedRelease` identity used by
runtime telemetry. Feed its `--json` result to the chosen backend adapter; the
CLI itself does not upload or read vendor credentials.

Install iOS pods before the first iOS build:

```sh
cd ios
bundle install
bundle exec pod install
cd ..
```

The generated `ios` and `android` directories are application-owned and may be
edited directly. `solid-native doctor` validates that their Hermes, Fabric,
JSI, CMake, CocoaPods, and package integration still matches the verified
backend.

The generated Android Activity forwards handled configuration changes to
React Native's bridgeless `ReactHost`. Preserve that callback when customizing
the Activity; native appearance and related platform subscriptions depend on
it even when the manifest prevents Activity recreation.

The iOS project sets `UIViewControllerBasedStatusBarAppearance` to `false` so
Solid Native's owner-bound `StatusBar` component can use the pinned native
manager. Keep that setting unless the application replaces the status-bar
backend with its own view-controller integration.
