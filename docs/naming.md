# Naming due diligence

Date checked: 2026-08-19

Status: **Solid Native is a working title, not a cleared public brand.**

The name is concise and accurately describes the product, but it is materially
overloaded in exactly the same category:

- [`tjjfvi/solid-native`](https://github.com/tjjfvi/solid-native) owns the
  unscoped `solid-native` npm package and implements Solid over React Native.
  Its README explicitly says the maintainer would be delighted to cede the name
  to a viable Solid + Native library that does not use React Native as its
  application renderer.
- [`Pickleboyonline/solid-native`](https://github.com/Pickleboyonline/solid-native)
  is another native Solid framework effort with its own runtime and iOS work.
- [`CasperHK/Solid-Native`](https://github.com/CasperHK/Solid-Native) is a third
  same-name mobile framework effort.

The first project is especially relevant: its stated naming condition is close
to this repository's architecture, which uses Fabric/Hermes as a backend but
does not use React or Fiber as the application renderer. That makes respectful
coordination more promising than attempting to out-rank an existing project.

## Recommendation

Continue technical work under the current title while APIs and branding are
provisional. Before a public launch or package publication:

1. Show the simulator proof to the original npm owner and ask whether they are
   open to consolidation, stewardship transfer, or a clear relationship between
   the projects.
2. Contact the other active same-name maintainers and the Solid core team to
   reduce ecosystem fragmentation.
3. Verify ownership of the desired npm scope, GitHub organization, domains, and
   social handles.
4. Commission an actual trademark search in intended markets. Repository,
   package, and DNS checks are not legal clearance.
5. Keep the name only if coordination produces a credible path to one canonical
   project. Otherwise rename before external adoption makes migration costly.

This is an ecosystem collision scan, not a legal opinion or trademark search.
