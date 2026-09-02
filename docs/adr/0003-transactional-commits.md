# ADR 0003: Fine-grained updates use transactional native commits

- Status: Proposed
- Date: 2026-08-19

## Context

Solid can recompute only the properties and structures affected by a signal. Native view systems still require coherent frames, layout calculation, cross-thread scheduling, and protection from partially applied application state. Applying each reactive write directly to platform views risks layout thrashing and visible intermediate states.

## Decision

Collect renderer operations per surface and coalesce them into an ordered transaction. Commit at the end of the relevant Solid flush unless an explicit synchronous host boundary is requested. The backend applies the transaction to its shadow state, performs layout as needed, and mounts the resulting platform mutations atomically.

## Consequences

- Fine-grained computation does not require fine-grained visible inconsistency.
- Repeated writes within a flush can be coalesced.
- Measurements, focus, and commands need documented commit semantics.
- Every surface needs sequence IDs and stale-event handling.
- The test backend can deterministically record and replay transactions.

## Validation

Create tests where several dependent signals update layout and content together. Verify one host commit, no intermediate native event observes mixed state, and synchronous measurement explicitly flushes pending work.
