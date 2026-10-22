# ADR 0011: Ticket attachments across online and offline modes

- Status: Accepted
- Date: 2026-10-22

## Context

Tickets need durable file attachments in the browser, connected Tauri, and fully local Tauri. File bytes must stay out of relational domain tables, uploads must not be buffered in application memory, and no product-level count or per-file size cap is required.

## Decision

- Keep attachment metadata in the Drizzle `ticket_attachment` table. Store stable IDs, workspace/ticket ownership, file name, MIME type, byte size, checksum where available, opaque storage key, version, audit fields, and soft-delete fields. The table contains no file bytes.
- Use the `BlobStorage` contract on the server. Cloud deployments require S3. Self-hosted servers may configure S3-compatible storage or an absolute filesystem directory. AWS credentials stay in the server's standard credential chain and never reach clients. Uploads stream through the API; S3 multipart parts are sent sequentially from streams, and the filesystem adapter writes atomically to a temporary file before renaming it.
- Web and connected Tauri use the same authenticated API and provider. When disconnected, they first commit the file Blob and an idempotent upload/delete mutation to IndexedDB; synchronization retries those mutations after reconnecting. A file is shown as synchronized only after the API acknowledges it. Browser and desktop storage quotas and available disk space can still reject a write.
- Fully local Tauri has no API or account dependency. It stores metadata in the selected SQLite database and streams files into `<data folder>/attachments/<prefix>/<attachment-id>.<extension>`. The native Rust command opens the system picker itself, so the webview cannot submit an arbitrary source path. Native commands resolve stored keys inside the attachment directory and open files through the operating system. On Unix, the attachment directories use mode `0700` and files use mode `0600`.
- Vesta does not impose an attachment-count or file-size cap. The active storage provider, filesystem, browser quota, network, or available disk space remains the practical limit. Amazon S3 multipart upload currently supports up to 10,000 parts of 5 GiB each (48.8 TiB per object); compatible providers may set different limits. Multipart uploads proceed one streamed part at a time, so server memory does not grow with file size.
- Attachment lists use 25-row keyset pages. Uploads accept multiple selected files and process them individually so a failure does not require buffering the full selection at once.
- Removing an attachment soft-deletes its metadata and retains its bytes. Ordinary ticket/workspace deletion follows the same rule. Physical cleanup and retention are separate maintenance operations and are not part of regular UI deletion.
- S3 operators should configure a bucket lifecycle rule to abort incomplete multipart uploads left by process crashes. Completed but soft-deleted objects remain retained until a future explicit retention/purge operation.
- Backups must include PostgreSQL plus the configured server blob store, or the local SQLite data folder plus its `attachments/` subdirectory. Close local Tauri before copying its folder. Do not use a cloud-synced folder as a live multi-device SQLite database.
- Moving an existing deployment between storage backends requires a maintenance migration: stop writes, copy every active and retained object while preserving each database storage key, verify the copied size and SHA-256 checksum against metadata, then change the server configuration and resume writes. Keep the source copy until the new backend is verified. There is no in-app provider migration tool.
- In online deployments the authenticated API authorizes every list, upload, download, and delete against workspace membership and the active ticket. Clients cannot choose storage keys or audit actors. Soft-deleted tickets cannot accept attachment operations.

## Consequences

All execution targets have a durable attachment path and share the same metadata contract and API behavior where an API exists. Online clients can add files while offline and retry without losing their local copy. Fully local Tauri can work without network access. Provider or device capacity failures are reported as failed operations and do not create successful metadata rows.

Soft-deleted bytes remain in storage until a separately designed retention process purges them, so operators must include retained blobs in backups and account for their storage cost. S3 credentials and IAM permissions must allow multipart upload, read, and delete on the configured bucket/prefix. A browser's IndexedDB quota is controlled by the browser and operating system, not Vesta.
