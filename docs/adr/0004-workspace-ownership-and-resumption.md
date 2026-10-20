# ADR 0004: Workspace ownership and resumption

- Status: Accepted
- Date: 2026-10-20

## Context

After authentication, each user needs a durable workspace to begin working. Accounts can create many workspaces and should resume the one they last used. The API must not trust client-supplied ownership, and workspace records follow the repository's soft-delete convention.

## Decision

- Store workspace identity in PostgreSQL `workspace` rows with a validated name, accent token, icon token, and shared lifecycle timestamps.
- Represent ownership and future membership through `workspace_membership`; scope every list and activation query to the authenticated user ID obtained from Better Auth.
- Store `last_accessed_at` on the membership so resumption remains per user if a workspace is later shared.
- Create the workspace and its owner membership in one database transaction. The creation time is also its first access time.
- Validate icon and accent tokens in the shared API contract and with database check constraints. The UI owns their locale-specific labels and color values.
- Use a stable paginated workspace list. Keep active membership rows unique and soft-deleted memberships out of ordinary lookups.

## Consequences

- The first authenticated visit opens a localized workspace creation form; later visits open the most recently activated workspace.
- Creating and switching workspaces require a reachable server. Offline durable storage and synchronization need a separate design and are not implied by this feature.
- A workspace membership is the authorization boundary for this feature. Future member invitations and role rules must extend this boundary without accepting ownership from a client.
