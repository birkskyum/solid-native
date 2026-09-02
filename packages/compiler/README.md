# `@solid-native/compiler`

This package is the single Solid-aware OXC compiler boundary used by Solid
Native build integrations. It pins `@dom-expressions/compiler`, targets the
universal renderer module, owns the shared built-in list, requests source maps,
and fails closed when either compiler cannot transform its input.

`transformSolidNativeJsx` leaves React Native-specific TypeScript, module,
platform, and Hermes lowering to Metro. `compileSolidNativeModule` additionally
uses `oxc-transform` to erase TypeScript and composes both source maps for a
standalone Babel-free build.

```js
import { compileSolidNativeModule } from "@solid-native/compiler";

const result = compileSolidNativeModule(source, "/app/Counter.tsx");
```

Plain `oxc-transform` is not a replacement for the Solid compiler: it does not
implement Solid's fine-grained JSX ownership and reactivity semantics.
