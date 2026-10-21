# ADR 0009: Real pagination for collection screens

- Status: Accepted
- Date: 2026-10-21

## Context

Collection screens must stay responsive as workspaces grow and must behave consistently when online or offline. Rendering a sliced subset of an unbounded in-memory list is not pagination: it still transfers and reads every record and cannot bound query cost.

## Decision

- Every collection screen uses pagination at its data source from its first version. React must not fetch the whole collection and slice it.
- Use keyset pagination over stable, immutable sort fields. The standard page size is 25 records. Repositories request at most 26 rows to decide whether a next page exists.
- Apply authorization scope, soft-delete filters, search, and other filters before ordering and limiting. Validate cursor fields at each external boundary.
- List APIs return the page items and a nullable next cursor. The UI implements Previous by keeping the cursor stack for pages already visited; it does not require an unbounded count query.
- Local SQLite uses the same keyset predicate and a bounded `LIMIT`. IndexedDB uses a compound index and advances its cursor until it finds one page of matching, non-deleted records.
- Connected clients can hydrate their offline replica through bounded sync pages. That process does not replace the paginated query used by the screen.
- Tests cover the first and later pages, filters that match beyond the first page, cursor progression, and soft-deleted records.

## Consequences

The Clients screen uses the same 25-item page and created-time/ID cursor in PostgreSQL, IndexedDB, and SQLite. Search is applied before pagination in each adapter. Previous and Next preserve the cursor chain, and the server does not need to count all matching clients to render the controls.

Future collection features must follow this rule and record any justified exception in an ADR before implementation.
