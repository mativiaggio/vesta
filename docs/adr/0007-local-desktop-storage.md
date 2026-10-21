# ADR 0007: Local-only packaged desktop storage

- Status: Accepted
- Date: 2026-10-21

## Context

The free packaged desktop app must work without an account, a running Vesta API, or PostgreSQL. The user-selected folder must contain its durable application data. Web deployments and self-hosted deployments continue to use the authenticated API and PostgreSQL. `npm run tauri dev` must keep using the current connected development workflow.

The current desktop product surface contains workspaces and language, theme, and date-format preferences. Those records need to use the selected data folder. Future desktop features must provide a local persistence implementation before they are considered available in local mode.

## Decision

- Treat packaged `self-managed` setup as a local-only desktop mode. It bypasses Better Auth, workspace synchronization, and API requests.
- Keep the deployment record in the OS app-config directory and store the native SQLite database as `vesta.sqlite3` inside the selected data folder.
- Access SQLite only through narrow Tauri commands implemented in Rust. The webview cannot submit file paths or arbitrary SQL. Native commands validate workspace inputs and preference keys and values.
- Use SQLite schema versioning, transactions, foreign-key enforcement, WAL journaling, and full synchronous commits. Application records have creation, update, and soft-delete timestamps.
- Store workspaces and local preferences in the selected folder. Local workspace CRUD writes to SQLite before the UI reports success.
- Keep browser and `npm run tauri dev` composition unchanged: those clients continue to use IndexedDB replicas and the authenticated API.
- Allow packaged desktop builds without `VITE_API_URL`. Connected builds can still provide that setting.
- Do not support placing the SQLite database in a cloud-synced folder or sharing a live database between computers. Multi-device use requires a synchronization protocol or a hosted/self-hosted API.

## Consequences

The current free desktop surface can open and manage workspaces without a server; its database and preferences stay under the chosen folder. A fresh install can select an existing Vesta folder and reuse its local database if its schema version is supported. Workspaces are soft-deleted and remain in the database.

The current local database schema is version 1. Future local data types need explicit SQLite migrations and native operations. A feature is not available in packaged local mode until its persistence and offline behavior are connected there. Existing IndexedDB account replicas are not automatically imported into the local database.

SQLite WAL files are kept beside `vesta.sqlite3`; users should close Vesta before backing up or moving the folder. Concurrent use or synchronization of the folder by cloud-drive software is unsupported.
