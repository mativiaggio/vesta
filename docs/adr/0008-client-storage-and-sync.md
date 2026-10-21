# ADR 0008: Client records across server and local desktop modes

- Status: Accepted
- Date: 2026-10-21

## Context

Client records need the same create, edit, active-state, and soft-delete behavior in the browser, connected Tauri, and packaged local Tauri app. Server-backed deployments use PostgreSQL. The packaged local app has no account or API and stores its authoritative data in the selected SQLite folder.

## Decision

- A client belongs to a workspace. Server requests derive the acting user from the authenticated session and verify active workspace membership for every list and mutation. Workspace ownership and audit user IDs are never accepted from the client.
- PostgreSQL uses a Drizzle-managed `client` table. Web and connected Tauri use an account-and-workspace-scoped IndexedDB replica with durable pending mutations. A mutation is queued locally before the UI reports it saved; retries use stable mutation IDs and PostgreSQL receipts.
- Packaged local Tauri stores clients in `clients` in the selected `vesta.sqlite3`, with a versioned SQLite migration and narrow Rust commands. Its actor ID is the local profile identifier `local`; these rows do not sync to a server.
- `version` increments on each saved change. Updates carry only changed fields: independent field edits merge, and concurrent edits to the same field resolve by server commit order. Deletion is terminal for active use and always records a soft-delete timestamp and actor. Sync explicitly includes tombstones; ordinary list queries exclude them.
- `code` is unique without regard to ASCII letter case among active clients in one workspace. Soft-deleted codes may be reused. A conflict is retained locally; editing the pending client coalesces the correction into a retryable mutation.
- All audit timestamps are UTC. Server audit user IDs come from the authenticated session; local desktop audit IDs use `local`.

## Consequences

The same UI and validation rules serve all three execution targets. Browser and connected desktop continue to use the existing IndexedDB offline replica while PostgreSQL is the synchronized source of truth. Local desktop works without network or account access and stores the same user-facing data in SQLite. A SQLite file is not shared across machines; multi-device concurrent access still requires the explicit sync protocol in ADR 0007.

Codes may be reused only after soft deletion. There is no normal physical-delete operation. Audit details remain stored even though the initial screen only shows the modified date.
