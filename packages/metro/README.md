# `@solid-native/metro`

This package uses the shared `@solid-native/compiler` boundary to compile
application TSX with the AST-native `@dom-expressions/compiler` OXC backend
before Metro performs React Native's platform and module lowering. It composes
the compiler map with Metro's module map without mutating Babel AST locations.

The Solid transform has no Babel fallback. The OXC compiler is pinned exactly
while its package remains on an experimental prerelease line, and unsupported
compiler input fails the build instead of silently switching semantics.

Use the exported worker path, Solid runtime resolver, and safe reload pattern in
the application Metro config:

```js
const {
  createSolidNativeFullReloadPattern,
  createSolidNativeMetroResolver,
  solidNativeTransformWorkerPath,
} = require("@solid-native/metro");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  transformerPath: solidNativeTransformWorkerPath,
  resolver: {
    resolveRequest: createSolidNativeMetroResolver(__dirname),
    unstable_forceFullRefreshPatterns: [
      createSolidNativeFullReloadPattern(__dirname),
    ],
  },
});
```

Metro distinguishes ESM `import` from CommonJS `require` when evaluating
package exports. Without the resolver, dependencies can pull `solid.js` and
`solid.cjs` into the same application, creating two independent reactive
graphs. The resolver pins every edge to one browser ESM runtime while retaining
Solid's development build for development bundles and production build for
release bundles.

Metro's built-in React Refresh considers exported component-shaped functions
to be React refresh boundaries. Solid component exports can satisfy that
heuristic even though React cannot replace their mounted Solid owners. The
full-reload pattern makes application JavaScript and TypeScript edits restart
the complete JavaScript/native surface lifecycle while excluding every
`node_modules` subtree. This is a correctness and cleanup boundary, not
owner-preserving Solid HMR; that requires an explicit compiler/runtime owner
replacement protocol.

React Native's Babel preset remains in the application config for its own
lowering after Solid JSX is gone. `babel-preset-solid` is not installed or
applied.

Both the resolver and transform-worker subpaths ship explicit TypeScript
declarations. The repository artifact gate packs this package, installs it into
an isolated NodeNext consumer, invokes the resolver through those declarations,
and rejects any JavaScript export that lacks a packed `types` condition.
