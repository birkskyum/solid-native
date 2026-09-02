# `@solid-native/secure-storage`

Bounded credential storage for Solid Native applications. The React Native
adapter targets the exact native ABI published by `react-native-keychain` 10
without evaluating its React-facing wrapper or runtime enums.

```ts
import { createReactNativeSecureStorage } from "@solid-native/secure-storage/react-native";
import { createSecureStorageController } from "@solid-native/secure-storage/solid";

const storage = createSecureStorageController(
  createReactNativeSecureStorage({ servicePrefix: "com.example.session" }),
);

await storage.setItem("refresh-token", token);
const restored = await storage.getItem("refresh-token");
await storage.removeItem("refresh-token");
```

Every key becomes a separate native generic-password service. Values are
limited to 65,536 UTF-16 code units and keys to 128. Empty values are encoded
so Android's non-empty credential ABI can represent them exactly. By default,
iOS values are available only while the device is unlocked and never migrate
to another device; Android requires at least software-backed Keystore storage.
Hardware-backed Android storage is an explicit opt-in because requiring it can
exclude otherwise supported devices. iCloud Keychain synchronization is always
disabled by this adapter.

The native dependency currently declares `RNKeychainSpec` but publishes no
discoverable `Native*` Codegen spec. Solid Native therefore labels this as an
explicit legacy-native seam. Before constructing `RCTHost`, the package-owned
Fabric Host enables React Native 0.87's bridgeless legacy-module interop, just
as that release's standard root factory does. The registry can then expose the
linked `RNKeychainManager`; this does not turn its empty Codegen declaration
into a generated TurboModule. All values crossing the fallback are validated
by the versioned `keychain-10` adapter. The adapter also supplies Keychain 10's
exact default authentication-prompt object because its iOS read implementation
cannot accept the missing value even for credentials without access control.

The Solid controller turns successful reads, writes, and removals into
default-priority causal platform events without recording keys or values.
Disposing its owner rejects unsettled application promises and prevents late
native results from re-entering retired Solid state. A native operation already
accepted by the platform cannot be canceled and may still complete.
