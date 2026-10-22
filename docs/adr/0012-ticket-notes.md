# ADR 0012: Ticket notes across online and offline modes

- Status: Accepted
- Date: 2026-10-22

## Context

Professionals need durable notes that stay attached to the ticket they document. Notes must remain useful without a network connection, support rich text and attachments, and behave consistently in the browser, connected desktop, and fully local desktop. Concurrent edits must not silently replace another device's work.

## Decision

- A note belongs to one workspace and one active ticket. PostgreSQL uses Drizzle; local desktop uses the selected SQLite database. Note and note-attachment rows have stable IDs, audit/version fields, soft deletion, and indexes. Deleting a ticket or workspace soft-deletes its notes and attachment metadata in the same transaction.
- Store content as validated Tiptap JSON, not HTML. The shared contract accepts a bounded set of text, block, list, and mark nodes and safe `http`, `https`, and `mailto` links. The React editor uses Tiptap StarterKit for headings, bold, italic, underline, nested lists, quotes, code, and links. The server and native local adapter enforce the same shape and limits.
- Notes lists use 25-item keyset pages ordered by immutable creation time and ID. Ticket filters apply before the page limit. The API sync feed includes soft-deleted notes so replicas can learn about remote deletion.
- Web and connected desktop commit notes plus idempotent mutations to IndexedDB before showing local success. Synchronization retries pending work and acknowledges server sync only after confirmation. PostgreSQL is authoritative after acknowledgement. A version mismatch preserves both copies and asks the user to keep the latest server copy or explicitly reapply local changes to its version. A deletion mismatch asks the user to keep the note or confirm deletion of the latest copy. There is no automatic last-write-wins merge.
- Fully local desktop commits through the native SQLite adapter and works without a Vesta API, account, or network. Its note rules and rich-text validation match connected clients. No network sync is implied in this mode.
- Note attachment metadata and relationships live in the database; file bytes do not. Online attachments use the existing provider-neutral `BlobStorage` contract and the same authenticated API as ticket files. Offline browser/connected-desktop writes persist file Blobs and queued mutations in IndexedDB. Fully local desktop stores files in its data directory and metadata in SQLite through safe native commands.
- Removing notes or attachments soft-deletes their records and retains attachment bytes until a separately authorized retention/purge operation. Backups include the server database plus its configured blob store, or the closed local SQLite data directory plus attachment files. A cloud-synced folder is backup/transfer storage only; it is not a safe shared live SQLite database.
- User-facing strings are localized in English and Spanish. The feature uses shared shadcn/ui controls and the common note contract across execution targets.

## Consequences

All three execution targets support note creation, editing, ticket association, formatting, and attachments. Web and connected desktop can create and edit notes while offline and preserve pending work across restarts. Server versions and explicit conflict choices protect concurrent changes. The local desktop remains independent of network services.

Tiptap JSON remains tied to the validated extension set, so any future editor extension must update the shared schema, Rust validator, and tests together. Offline edits and files consume local browser or device storage, and those platform quotas can reject writes. Soft-deleted attachment bytes require backup space until a separately designed retention operation removes them.
