# @solid-native/react-native-compat

This dependency-free package is the executable compatibility contract for the
React Native backend selected by Solid Native. It keeps four identities
explicit and independently reviewable:

- the exact React Native npm package release used by build tooling;
- the normalized React Native version exposed by `PlatformConstants` and the
  JSI host;
- the matching Hermes compiler release;
- the matching Hermes bytecode format.

Those values happen to share the same `0.87.0` package/runtime string in the
current stable backend. They must not be treated as one identity: React Native
nightly packages retain a prerelease suffix while their native runtime exposes
only major, minor, and patch numbers.

`assertVerifiedReactNativePlatform` is shared by the runtime facade and direct
TurboModule adapters. It validates the normalized version and resolves Android
or iOS before an adapter touches a version-sensitive native API.

The CLI consumes the same release definition for dependency, Hermes, and HBC
checks. `@solid-native/fabric-host` adds the host-contract and physical-proof
metadata for that release. Native Android and Apple bindings publish their
runtime identity from one C++ header, and the native integration suite verifies
that header against this package.
