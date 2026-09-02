# `@solid-native/codegen`

This package projects React Native 0.87's validated Codegen schema into Solid
Native component and raw TurboModule bindings. React Native Codegen remains
responsible for the generated C++/Objective-C++/Java/Kotlin ABI; Solid Native
consumes the same schema without importing or executing generated React
wrappers.

```ts
import { writeFile } from "node:fs/promises";
import {
  combineReactNativeCodegenSchemas,
  generateSolidNativeComponentModule,
} from "@solid-native/codegen";

const schema = combineReactNativeCodegenSchemas(["./specs"], {
  libraryName: "ApplicationSpec",
});
await writeFile(
  "./generated/ApplicationSpec.ts",
  generateSolidNativeComponentModule(schema),
);
```

The generated, React-free TypeScript module exports typed Solid component
factories, typed native command shims, individual deeply frozen descriptors,
and the complete `SOLID_NATIVE_COMPONENT_DESCRIPTORS` list. The lower-level
`createSolidNativeComponentDescriptors` API can project an already-produced
schema directly. Generation is deterministic, so applications can check the
artifact in and fail CI when it becomes stale.

Component names, prop types, semantic direct/bubbling events, command parameter
order, and platform exclusions come from the upstream schema. `interfaceOnly`
entries are excluded by default because React Native Codegen does not generate
an independent Fabric descriptor for them; applications may opt in only when
their backend provides that component through another reviewed registration
path. Raw-text acceptance is likewise explicit application policy because it
is absent from the upstream schema.

`createSolidNativeSchemaAudit` produces a deeply frozen, path-free inventory
from the same validated schema. It separates directly projected component and
TurboModule descriptors from interface-only and platform-excluded names, and
retains each module descriptor's `unknownValueMembers`. This is a static ABI
compatibility result: it does not claim that a native package is registered,
initialized, semantically adapted, or proven on a device.

For TurboModules, generate a separate raw ABI module from the same schema:

```ts
import {
  combineReactNativeCodegenSchemas,
  generateSolidNativeTurboModuleBindings,
} from "@solid-native/codegen";

const schema = combineReactNativeCodegenSchemas(["./specs"]);
await writeFile(
  "./generated/ApplicationModules.ts",
  generateSolidNativeTurboModuleBindings(schema),
);
```

The module exports prefixed alias/enum types, method and event-emitter
interfaces, optional and enforcing resolvers that accept an injected
TurboModule registry, and deeply frozen runtime descriptors. Resolution checks
that required methods and event emitters are present and callable. Descriptor
`unknownValueMembers` identify members containing Codegen `mixed`, `any`, or an
untyped `Object`; those become `unknown`, never `any`, in TypeScript.

These are intentionally raw ABI contracts. A generated interface proves which
values can cross the native bridge, not that those values satisfy an
application-domain contract. Packages should retain an explicit adapter like
`@solid-native/storage/async-storage-3` to validate returned objects, bound
inputs and lifetimes, and expose portable Solid-owned services. The generated registry
interface avoids a hard React Native import, while accepting React Native's
`TurboModuleRegistry` structurally at the application boundary.

Generated `SolidNativeEventEmitter<T>` members structurally match
`@solid-native/core`'s `createNativeEventAccessor`. That helper requires an
explicit decoder, binds the subscription to a Solid Native owner, and enters
valid deliveries through the causal scheduler without recording their values.

For an editable starting point rather than another generated ABI file, select
one module with `generateSolidNativeTurboModuleAdapterScaffold`:

```ts
import {
  combineReactNativeCodegenSchemas,
  generateSolidNativeTurboModuleAdapterScaffold,
} from "@solid-native/codegen";

const schema = combineReactNativeCodegenSchemas([
  "./node_modules/example/specs",
]);
const source = generateSolidNativeTurboModuleAdapterScaffold(schema, {
  moduleName: "ExampleModule",
  bindingsImport: "../generated/ExampleBindings.js",
});
```

The scaffold is application-owned, deterministic starting material. It exposes
every native method through a required policy hook, passes a bound native
invoker plus a frozen argument tuple to that hook, and types its result as
`unknown`. Application code must narrow the result by replacing the scaffold's
portable contract as it implements bounded input and output validation. It
does not generate an unsafe pass-through adapter. Required and optional
Codegen event emitters instead use `createNativeEventAccessor`; their policy is
an explicit decoder and causal event identity, and subscription cleanup belongs
to the current Solid owner.

`generateSolidNativeBindingsModule` emits both component and TurboModule
sections into one deterministic artifact when `codegenConfig.type` is `all`.
