# ADR 0005: Workspace offline replica and synchronization

## Status

Accepted.

## Context

Workspace creation and selection must remain usable without a network connection on both the web and Tauri clients. A React state cache is insufficient because acknowledged work must survive navigation, crashes, and restarts. Retried requests must not create duplicate records, and PostgreSQL remains authoritative after synchronization.

## Decision

- Use an account-scoped IndexedDB database as the durable workspace replica for the shared React client. Tauri uses the same typed adapter through its webview for this initial workspace domain; a future SQLite adapter may implement the same contract when native-scale requirements justify it.
- Commit the local workspace state and its pending mutation in one IndexedDB transaction before updating the UI.
- Generate stable workspace and mutation UUIDs on the client. The server stores a per-user mutation receipt with a SHA-256 payload hash and treats an identical retry as success while rejecting reuse with different content.
- Retain mutation receipts for 30 days, then physically purge them as an explicit data-retention operation. Maintenance uses a PostgreSQL advisory leader lock, bounded `500 × 10` batches, short backlog scheduling, hourly idle checks, jitter, and exponential retry after failure. A hard limit of 10,000 outstanding receipts per user prevents unbounded growth even during a prolonged maintenance outage. Clients with older pending mutations surface a conflict for recovery.
- Apply shared PostgreSQL-backed hourly and daily mutation limits per authenticated user before accepting workspace writes. Both windows are consumed atomically using database time and a dedicated table, isolated from Better Auth's independent throttling lifecycle. Expired workspace-limit rows are physically removed by the same bounded maintenance process. The implementation runs in self-hosted and managed deployments and coordinates across server replicas.
- Send mutations in creation order. Transient/network failures remain pending; permanent 4xx conflicts are retained as failed records for explicit recovery rather than silently discarded.
- Use explicit workspace and membership versions. Activation uses a deterministic maximum timestamp policy; general last-write-wins is not adopted for future entities.
- Page server replicas with a stable `(membership.created_at, membership.id)` cursor and a maximum of 50 rows.
- Cache only the web application shell and visited static assets. API responses are never service-worker cached. A cached non-credential identity can select its own local replica offline, but server authorization is still required for every synchronization request.

## Consequences

Workspace creation and switching survive restarts and reconnect safely without provider-specific infrastructure. Local records and durable language/theme preferences use IndexedDB rather than `localStorage`; workspace replicas are isolated by authenticated user ID. The current IndexedDB adapter is intentionally narrow: documents, tasks, attachments, deletes, multi-device field conflicts, and schema upgrades require their own domain policies and tests before they are called offline-capable.
