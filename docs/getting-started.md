# Getting started from the source repository

Solid Native is not published as an installable SDK yet. Every workspace
package is private and versioned `0.0.0`, so this guide is for evaluating and
contributing from a source checkout. The generated-project workflow is already
implemented, but it becomes an external quickstart only after the package set,
license, and release policy are public.

## Verify the checkout

Use a supported Node.js release and the repository's pinned pnpm version:

```sh
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm check
node packages/cli/dist/bin.js doctor --platform all
```

`doctor` is intentionally honest at the workspace root: it validates the
toolchain and package workspace, but skips application-native checks because
the root is not an iOS or Android application.

To test the actual first-user boundary rather than workspace links, create a
fresh application from packed artifacts in an external temporary directory:

```sh
pnpm run starter:verify
# Release-compile both native projects on macOS:
pnpm run starter:verify -- --platform all --native-build
# Exercise the exact packed Release starter on unlocked physical Android:
pnpm run starter:verify -- --platform android --android-device DEVICE_SERIAL
# Signed-build and launch it on an unlocked physical iPhone:
pnpm run starter:verify -- --platform ios --ios-device DEVICE_ID --ios-team TEAM_ID
```

The command is an opt-in local release gate and is not called by GitHub Actions.
It preserves a failed project for inspection and removes a successful one unless
`--keep` or `--output PATH` is supplied. `--android-device` implies native
compilation and uses a random, collision-free application ID. It rejects
emulators, an unavailable or securely locked phone, and any unexpected existing
package before packing or Gradle begins, then repeats the checks immediately
before installation. The gate launches the Release APK, reads only its bounded
accessibility tree after checking its embedded application ID, injects one tap
into the discovered increment action, requires the Solid-owned counter to reach
one, then verifies package, process, temporary UI document, and
stay-awake-setting cleanup.

The iOS form likewise rejects an unavailable, nonphysical, locked,
Developer-Mode-disabled, or bundle-colliding target before expensive work. It
requires the Apple development team identifier shown by Xcode, resolves a
CoreDevice UUID or hardware UDID to the exact physical destination, and repeats
the safety checks after compilation. The gate verifies the signed `.app` bundle
and team identities, installs and launches it, requires the process to remain
alive, then terminates and uninstalls it. It is intentionally a signed launch
proof; the repository's XCTest runners own iOS accessibility interaction
claims. The dedicated `dev.solidnative.packedstarter.iosgate` identity is
stable so automatic signing can reuse one provisioning profile; collision
refusal prevents an interrupted run from silently replacing that app.

Both hardware modes have completed on the repository's current packed package
set: Android on a Pixel 9a through the physical counter interaction, and iOS on
an iPhone 17 Pro through signed launch and verified cleanup. The current iOS
proof runs `solid-native add navigation` first, verifies the patched native
files, and resolves `RNScreens` through the generated CocoaPods graph before
the signed Release build. The parsers accept modern ADB's bounded multi-line
streamed-install acknowledgement and Xcode 26.6's `runningProcesses` CoreDevice
inventory while still failing closed on ambiguous schemas, failed commands,
identity mismatches, and incomplete cleanup.

Run the smallest complete Solid render loop without starting a simulator or a
device:

```sh
pnpm --filter @solid-native/native-sandbox start
```

That compiles TSX with the OXC Solid universal transform, mounts the result in
the deterministic native host, delivers a discrete press, commits the signal
update, measures the native node, and disposes the surface.

## Run the checked-in native application

The application under `apps/native-e2e` is evidence infrastructure, not the
eventual tutorial app. It is nevertheless the shortest current path to the real
Hermes/Fabric backend.

For an authorized, unlocked Android phone:

```sh
adb devices
SOLID_NATIVE_ANDROID_SERIAL=<serial> \
pnpm --filter @solid-native/native-e2e android:install
```

The command builds a Release APK, installs it, and starts its real Activity.
It fails closed when the device is locked or unauthorized and restores the
device's stay-awake setting afterward.

For a paired, unlocked iPhone, first select an Apple Development team in Xcode,
then use the CoreDevice identifier and team identifier:

```sh
xcrun devicectl list devices
SOLID_NATIVE_IOS_DESTINATION=<device-id> \
SOLID_NATIVE_IOS_TEAM=<team-id> \
pnpm --filter @solid-native/native-e2e ios:release
```

The iOS runner installs pods, creates a signed Release build, replaces any
older test process, installs the app, and launches it on the selected phone. It
checks CoreDevice's current lock state before compiling, so an auto-locked
phone fails quickly instead of leaving Xcode waiting after an expensive build.

## Understand an application root

A generated application's `src/main.tsx` performs the platform bootstrap once:

```tsx
/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import { CORE_COMPONENT_DESCRIPTORS } from "@solid-native/core";
import {
  getNativeHostBinding,
  startNativeApplication,
} from "@solid-native/runtime";

import { App } from "./App";

const binding = getNativeHostBinding();

void startNativeApplication(() => <App />, {
  binding,
  descriptors: CORE_COMPONENT_DESCRIPTORS,
  surface: { name: "main" },
});
```

The generated template adds the development error boundary, bounded network
inspector, and causal debugger around this same core. `startNativeApplication`
owns the fatal native handoff through failed startup, normal operation, and
explicit disposal.
Application components remain ordinary Solid functions. A signal updates only
the dependent native output:

```tsx
/** @jsxImportSource @solid-native/core */
import { Pressable, Text, View } from "@solid-native/core";
import { createSignal } from "solid-js";

export function App() {
  const [count, setCount] = createSignal(0);

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text accessibilityRole="header">Count: {count()}</Text>
      <Pressable
        accessibilityLabel="Increment count"
        accessibilityRole="button"
        onPress={() => setCount((value) => value + 1)}
      >
        <Text>Increment</Text>
      </Pressable>
    </View>
  );
}
```

There is no React component tree or WebView in this path. React Native remains
the pinned native backend that supplies Hermes, JSI, Fabric, Yoga, platform
views, and native-module infrastructure.

## Use a refreshable bounded list

Vertical `VirtualizedList` owns a bounded Solid row window and can compose the
native Android/iOS refresh control directly. `refreshing` is controlled, and
the list handle still targets the backing ScrollView:

```tsx
<VirtualizedList
  data={messages()}
  itemSize={56}
  recycleRowViews
  viewportSize={viewportHeight()}
  keyExtractor={(message) => message.id}
  renderItem={({ item }) => <Text>{item().body}</Text>}
  refreshing={refreshing()}
  onRefresh={() => {
    setRefreshing(true);
    void reload().finally(() => setRefreshing(false));
  }}
/>
```

Use `getItemLayout` instead of `itemSize` for exact heterogeneous layouts. For
content-dependent rows, use a positive `estimatedItemSize`; mounted rows replace
that estimate with native layout while measurements remain attached to stable
keys. Exact layouts are still preferable when the first imperative jump must
know all preceding offsets. `recycleRowViews` opt-in keeps the bounded native
wrapper slots stable while disposing and remounting keyed `renderItem` owners;
this is distinct from React Native's opaque lower-level platform pools.

## Test application behavior without a device

`@solid-native/testing` renders the same Solid components into a strict,
transactional in-memory host:

```tsx
import { renderNative } from "@solid-native/testing";

const screen = await renderNative(() => <App network={testNetwork} />);

await screen.press(screen.getByRole("button", { name: "Increment count" }));
screen.getByLabelText("Press count: 1");

// Return a bounded native tree for assertion messages or local diagnostics.
console.log(screen.debug());

await screen.cleanup();
screen.assertDisposed();
```

Here `testNetwork` is a deterministic `NetworkService` fake; the generated
`test/App.test.tsx` contains the complete executable example. Run it with
`pnpm test`, which uses the shared Solid/OXC compiler and Node test runner.
`screen.debug()` includes native node handles, accessibility semantics, event
subscriptions, and text without writing to the console itself. Pass
`{ includeProps: true }` only when the bounded transport-prop JSON is useful.
For delayed native-service or streamed updates, use
`await screen.findByText("Loaded")`, the equivalent `findByRole`/label/test-ID/
component query, or a synchronous assertion inside `screen.waitFor`. Each
attempt flushes pending output and timeout errors include the last assertion
plus a clipped native tree and recent native transactions. `debugCommits()`
returns that render-scoped transaction tail directly; pass
`{ includeValues: true }` only when text, props, or command arguments are needed.
For structural transaction assertions, capture `screen.commitCheckpoint()`
before the action and pass it as `afterSequence` to `getCommit` or
`getMutation`; these typed queries match priorities, causal IDs, ordered
mutation kinds, native identities, and component/command or prop/event names
while keeping application values out of failure diagnostics.
When navigation retains multiple mounted screens, use
`screen.within(screen.getByTestId("account-screen"))` and query that native
subtree; scoped queries include the root and reject stale or cross-render roots.
During development, `pnpm test -- --watch` reruns affected tests when imported
files change; add `--test-name-pattern "counter"` to focus a bounded regular
expression without changing source.

This validates Solid ownership, native events, commits, queries, and exact
cleanup. It does not simulate Fabric, Yoga, operating-system UI, or device
performance; use the checked-in physical runners for those claims.

## Generate a new application

The eventual published workflow is:

```sh
solid-native create MyApp \
  --package-name dev.example.myapp \
  --title "My App"
cd MyApp
solid-native add navigation
pnpm test
pnpm run doctor
pnpm start
```

In a second terminal, run `pnpm android` or `pnpm ios`. Edit `src/App.tsx` and
run `pnpm check` before a native build. Today this command is maintained and
tested inside the monorepo, but its generated `0.0.0` dependencies are not
available from a public registry. Do not present it as an external installation
path until package publication is complete.

`add navigation` is the first reviewed capability recipe. It pins the supported
screens backend, copies and verifies the required application-owned patch,
updates the pnpm patch mapping without replacing other settings, and applies
it. It reports success only after the installed package identities and reviewed
native files match the shipped contract. Inspect the complete non-mutating plan first with
`solid-native add navigation --dry-run --json`. The packed external-starter gate
executes this recipe before its doctor and production-bundle checks.

## When something fails

Start with the application-local diagnostic:

```sh
pnpm run doctor
pnpm run doctor --platform android
pnpm run doctor --platform ios
```

Use `pnpm run doctor` explicitly: `pnpm doctor` names pnpm's own diagnostic
command and does not execute the application script.

It checks the exact React Native, Hermes compiler/HBC, Solid singleton,
OXC/Metro, Codegen, Gradle, CocoaPods, JDK, SDK, and native bootstrap contracts.
The Android check also calls out the generated starter's intentional
`signingConfigs.debug` Release fallback: it permits local Release builds but is
not valid store-signing configuration. Configure an application-owned
non-debug signing config with externally injected credentials before uploading
an AAB. Doctor can verify that static intent, not possession or Play acceptance
of the key. Release CI can add `--strict` to make any warning or failure return
a nonzero status; ordinary local doctor runs continue to tolerate warnings.
For Android, an explicit `JAVA_HOME` always wins. When it is absent, the CLI
discovers Android Studio's bundled JBR and carries that exact path through
`doctor`, `run`, and `build`; a dry run prints the resolved environment before
Gradle starts. This avoids requiring a shell-wide Java change when Android
Studio already provides a compatible JDK.
For a deterministic physical launch, pass the exact adb serial with
`pnpm android -- --device SERIAL`. Solid Native checks that target and its
secure-keyguard state before Gradle starts, then holds a reversible wired
stay-awake lease until the React Native command exits. The phone's previous
setting is restored on both success and failure. A second local run targeting
the same serial is rejected until the first owner exits; after an abrupt process
kill, the next run restores the recorded setting before taking ownership.
Emulator targets are checked but never receive the power-setting lease.
Plain `pnpm android` applies the same contract when exactly one authorized
target is attached and pins that resolved serial into the React Native command.
With multiple targets, select one explicitly or use
`pnpm android -- --list-devices` for React Native's interactive picker.
Use the package-scoped guides for deeper work:

- [Core components](../packages/core/README.md)
- [Testing](../packages/testing/README.md)
- [Navigation](navigation.md)
- [Native compatibility](react-native-compatibility.md)
- [Developer tooling and managed-services boundary](developer-platform.md)
