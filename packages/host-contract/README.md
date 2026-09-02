# `@solid-native/host-contract`

This package contains the backend-neutral `NativeHost` type model between any
framework renderer and a native host. It is intentionally private and
provisional; `SolidNativeHost` remains only as a deprecated compatibility alias.

The contract models:

- Multiple native surfaces
- Opaque node handles
- Ordered and prioritized commit transactions
- Optional causal context and revision-aware commit-mount/frame lifecycle events
- Element/text creation, updates, insertion, removal, deletion, and commands
- Native events and measurement
- Backend capabilities and component descriptors

The React Native/Fabric adapter and in-memory test backend should both implement this contract. Any type that requires importing React, Fiber, or Fabric internals belongs in a backend package instead.

Host capability and component validation also belongs here rather than in a
framework runtime. Adapters can reject an incompatible backend before creating
a native surface:

```ts
import { assertCompatibleHost, inspectHost } from "@solid-native/host-contract";

const report = inspectHost(host, {
  components: ["RootView", "Text"],
  capabilities: ["bubblingEvents", "commitMountEvents"],
});

if (report.compatible) {
  const fingerprint = assertCompatibleHost(host);
}
```

`inspectHost` returns a deterministic, portable fingerprint and issue list.
`assertCompatibleHost` returns that fingerprint or throws a structured
`IncompatibleHostError`. The Solid runtime re-exports the same functions for
source compatibility and applies them before mounting a Solid root.
