# `@solid-native/storage`

This package exposes a small validated asynchronous string store. Portable
application and navigation code depend on `KeyValueStorage`; versioned native
ABI adapters remain explicit subpath imports.

The preferred AsyncStorage 3.x boundary accepts an injected, generated native
binding and never evaluates the dependency's React-facing JavaScript wrapper:

```ts
import { createAsyncStorage3KeyValueStorage } from "@solid-native/storage/async-storage-3";
import { requireRNAsyncStorageNativeModule } from "./generated/SolidNativeBindings";
import * as TurboModuleRegistry from "react-native/Libraries/TurboModule/TurboModuleRegistry";

const native = requireRNAsyncStorageNativeModule(TurboModuleRegistry);
const storage = createAsyncStorage3KeyValueStorage(native, {
  databaseName: "application",
  prefix: "solid-native",
});
```

Only `getValues`, `setValues`, and `removeValues` enter this adapter. Native
methods are bound to their module, input collections are frozen, and the
`getValues` result is treated as `unknown` until its key/value shape and
requested-key identity have been validated. Unknown legacy ABI members never
reach the portable storage contract. The package has no AsyncStorage or React
Native JavaScript dependency; the application owns installation, autolinking,
and generated registry resolution. The adapter validates database names, keys,
and returned native values. It does not encrypt values; credentials and other
secrets require a secure platform store instead.

Adapter construction is an explicit runtime boundary, not a harmless import to
perform speculatively. AsyncStorage 3.1.1's iOS implementation embeds a
Kotlin/Native `SharedAsyncStorage` framework; creating the adapter activates
its coroutine and garbage-collection runtime for the rest of the process. An
application that does not need storage during its first screen should load and
construct this adapter on demand. Applications that require process
restoration before first mount necessarily accept that startup cost or should
select and validate a different native backend.

The portable result also satisfies `@solid-native/navigation`'s explicit
storage contract:

```ts
const launch = await createNativeHistoryFromStorage({
  storage,
  storageKey: "navigation",
});
const persistence = createNativeHistoryPersistence(launch.history, storage, {
  storageKey: "navigation",
});
```

Navigation owns versioning, validation, ordered/coalesced writes, and the
durability boundary. This package only owns the native storage adapter. The
generated-binding path is unit-tested against malformed native results and is
present in the Android Release bundle; a source-map gate rejects the build if
the dependency's JavaScript wrapper enters that bundle. The existing process
restoration suites remain the physical promotion gate. Their refreshed Android
run passes on a tethered Pixel 9a, including process restoration, 30 native
navigation cycles, and cold-link precedence. The equivalent generated-path
iPhone run remains pending.
