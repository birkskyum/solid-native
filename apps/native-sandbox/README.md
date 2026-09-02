# Native sandbox

This application is the first executable vertical integration target, not a
showcase app. Its TSX is compiled through the shared
`@solid-native/compiler` boundary with the pinned `@dom-expressions/compiler`
OXC universal backend. TypeScript is erased by `oxc-transform`, and both source
maps are composed. The sandbox has no Babel dependency. Its result is rendered
through the transactional renderer into the deterministic in-memory host.

```sh
pnpm build
pnpm --filter @solid-native/native-sandbox start
```

The command prints the mounted text, commit priorities, and a controlled native
measurement after injecting a discrete press event.

Implemented in the sandbox:

- View/Text/Pressable/ScrollView creation
- Fine-grained signal-driven text updates
- Discrete native event delivery
- NativeStack ownership plus a Solid 2 Loading fallback/reveal
- Controlled measurement boundaries

Implemented in the host-independent conformance suite:

- Atomic multi-signal commits
- Style normalization and structural reconciliation
- Event capture/bubbling and cleanup
- Measurement, focus, command, and disposal boundaries

Required native scenarios:

- Two-screen TanStack Router navigation
- Deep link and platform back
- Live camera preview and its opaque-native-resource lifetime contract (the
  AsyncStorage/SQLite, local-notification, and physical camera-session proofs
  live in `apps/native-e2e`)
- Text-heavy and list-heavy performance cases
- An equivalent React Native control screen for comparison

Keep test scenarios small, deterministic, and measurable.
