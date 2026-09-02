# Dependency license inventory

The installed workspace graph has a deterministic, review-gated license
fingerprint. It covers production dependencies and development/build tooling
because the latter participates in producing native bundles and generated
artifacts.

```sh
pnpm licenses:verify
pnpm licenses:inventory > dependency-licenses.json
```

`licenses:verify` normalizes every installed package name, exact version, and
declared license expression from pnpm, then compares the entry count, per-license
counts, and SHA-256 fingerprint with
[`dependency-license-policy.json`](dependency-license-policy.json). CI fails on
an added, removed, upgraded, or re-licensed dependency until the normalized
inventory is reviewed and the policy is intentionally updated. Absolute local
installation paths are excluded from the fingerprint.

The current graph reports MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause,
0BSD, Python-2.0, Unlicense, CC-BY-4.0, `(MIT OR Apache-2.0)`, and
`(MIT OR CC0-1.0)`. The less-common declarations currently come from packages
such as `argparse`, `big-integer`, `caniuse-lite`, `fb-dotslash`,
`jsc-safe-url`, `stream-buffers`, and `type-fest`; they should receive explicit
notice review before distribution.

The direct `react-native-keychain@10.0.0` runtime dependency declares MIT and
ships the corresponding Joel Arvidsson copyright and permission notice. Its
addition is included in the current count, license totals, and fingerprint;
binary-distribution notice generation must retain that notice.

The development-only `@solidjs/diagnostics@2.0.0-rc.3` dependency also declares
MIT. It is included because deterministic native tests now consume its official
Solid attribution artifacts; it is not part of production application bundles.

This gate detects dependency/license drift. It is not a legal conclusion, does
not replace reading the actual license and notice files, and does not license
Solid Native itself. The repository and packages remain private/unlicensed
until the project selects its own license, completes notice generation for
binary distribution, and obtains any necessary legal review.
