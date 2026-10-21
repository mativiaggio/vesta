# ADR 0006: Packaged desktop deployment setup

- Status: Accepted
- Date: 2026-10-21

## Context

The packaged desktop application needs a first-run choice between Vesta Cloud and a self-managed local setup. Cloud is not available yet. `npm run tauri dev` is the existing development workflow and must keep opening the current application directly.

The packaged self-managed desktop setup must use the chosen folder as its data location. Its first local database and deployment-mode behavior are specified in [ADR 0007](0007-local-desktop-storage.md).

## Decision

- Show deployment setup only in packaged Tauri builds. Tauri development and browser builds skip it.
- Keep Cloud visible and disabled until the managed service is implemented.
- For self-managed setup, use a native folder picker and store the selected absolute path and deployment mode in Tauri's app configuration directory.
- Use the OS app-local-data directory as the suggested folder. Validate and canonicalize the path in Rust before persisting it.
- Use the selected folder for this device only. Multi-device folder synchronization is not part of this setup flow.
- Keep the data-directory configuration as a narrow native capability. Do not grant the webview general filesystem access.

## Consequences

Packaged desktop users can select and persist a local data location before entering the application. The setup record stays in the OS app-config directory, while application data is stored in the selected folder. Network synchronization of that folder is not supported.

The default development workflow remains unchanged. The packaged executable can be built with the existing Tauri build command, and its first launch exercises the new setup flow.
