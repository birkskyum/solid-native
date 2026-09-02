# ADR 0004: Adapt Solid's server and continuation model to native clients

- Status: Proposed
- Date: 2026-08-21

## Context

Solid 2 makes promises and async iterables ordinary reactive computation
results. It defines server/client source policies, loading and error boundaries,
actions, optimistic state, affected-data declarations, refresh, and
reconciliation as parts of one graph.

A native application does not need HTML SSR or a server-rendered Fabric tree.
It can still benefit from receiving authoritative initial data, resuming async
work, invoking typed server mutations, and applying streamed changes to its
local Solid graph.

The `solid-js` `2.0.0-rc.3` types expose `ssrSource` policies and document a
container continuation materializer, but hydration coordination and the
materializer are internal and described as consumers of the web serialization
layer. Coupling a native platform directly to those details would create an
unreviewed dependency on browser globals and prerelease internals.

The upstream `next` branches also contain shipped-prerelease server-function
mechanics with transport, result, response, and single-flight extension hooks.
Those hooks are framework-oriented rather than DOM rendering operations, but
their package and runtime path has not been validated on Hermes/native. The
same branches contain an experimental server-component frame protocol under
active development. Its design reserves a future renderer-operations payload
and renderer adapters, while its current producer and client materializer are
intentionally DOM/HTML-specific. Review that boundary again after the current
upstream design pass; do not fork its moving wire format into this repository.

## Decision

Pursue a renderer-neutral Solid server/native transport adapter. The server
sends reactive data snapshots, bounded async continuations, action results,
invalidation information, and causal context. The native client owns its local
Solid component tree and translates resulting reactive changes through the
existing transactional host contract.

Do not send HTML, DOM morph instructions, or Fabric/native-view mutations over
the application data protocol. Do not expose the transport as supported until
there is either a public upstream seam or a small versioned adapter with an
explicit compatibility matrix and upgrade gate.

Treat native server-component frames as a separate second-stage decision. A
future frame may carry backend-neutral, schema-validated Solid Native component
operations as its one representation of server-owned content; it must never
carry raw Fabric objects or platform calls. Evaluate this only after the active
upstream frame work settles and the data-only path is understood.

The protocol must keep these identities separate:

- Application protocol/schema version
- Solid runtime and serializer compatibility
- Native runtime ABI and host-contract version
- Request, action, continuation, owner, and causal operation IDs

The implementation must permit a self-hosted server and custom transport.
Gateways, retention, delivery, observability, and compatibility policy remain
replaceable protocol consumers rather than runtime requirements.

## Consequences

Benefits:

- Web and native clients can share server functions, queries, validation,
  optimistic rules, and invalidation semantics.
- Cold-start data can be authoritative without a duplicate client fetch.
- Async store changes can preserve fine-grained identity into native updates.
- Owned native screens can cancel their server continuations on disposal.
- One causal trace can cross native input, server work, reactive invalidation,
  host revision, mount, and frame boundaries.
- Protocol/runtime fingerprints can inform safe delivery and release tooling.

Costs:

- Solid's current web protocol is prerelease and not a public generic transport.
- Authentication, replay protection, backpressure, reconnection, offline
  mutation policy, schema evolution, and bounded resource use become explicit
  platform responsibilities.
- Native cold start cannot assume a network, so persisted snapshots and loading
  behavior need deterministic fallback semantics.
- Sharing business logic does not imply sharing UI or every web framework API.
- Upstream collaboration may be necessary before the adapter is supportable.

## Validation

Before accepting this ADR, build an isolated experiment that:

1. Starts a native Solid root from a validated server snapshot without a
   duplicate initial read.
2. Streams a bounded async-store trace and changes only the dependent native
   nodes in one transaction per received batch.
3. Invokes an authenticated action from a native event, publishes optimistic
   state, and proves both successful reconciliation and failure rollback.
4. Cancels a continuation when its owning screen is disposed and ignores a
   late result.
5. Rejects unknown versions, malformed values, out-of-order batches, duplicate
   action settlement, oversized payloads, and unsafe replay.
6. Reconnects from a persisted committed cursor without duplicating mutations.
7. Propagates privacy-safe causal context through the server and back to the
   exact native host revision and frame opportunity.
8. Uses only documented APIs or records the exact upstream extension required
   to remove private coupling.

The experiment must compare this path with a conventional typed HTTP query and
mutation adapter. A universal protocol is justified only if it reduces real
application complexity or enables observability and streaming behavior that a
simpler transport does not.
