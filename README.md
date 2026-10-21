# Vesta

Vesta is a focused digital office for independent professionals. The packaged desktop app has a free local mode; browser and self-hosted deployments use the authenticated API.

## Development

- Install dependencies: `npm install`
- Copy `.env.example` to `.env`, set a 32+ character `BETTER_AUTH_SECRET`, and point `DATABASE_URL` at PostgreSQL.
- Apply the reviewed database migration: `npm run db:migrate`
- Start the desktop app, API, and web UI together: `npm run tauri dev`
- For web-only development, start the API with `npm run dev:server` and the web UI with `npm run dev` in separate terminals.
- Create the web build: `npm run build`
- Run the complete formatting, lint, type, test, build, performance, and Rust checks: `npm run check`
- Type-check the API only: `npm run build:server`
- Build a versioned Windows desktop installer: `npm run release:all -- 0.1.5` (updates package and Tauri version files, then builds the NSIS installer; no API or PostgreSQL is required). The installer is written to `src-tauri/target/release/bundle/nsis/`.
- Stage an official GitHub Release asset: `npm run release:all -- 0.1.5 --official`. This also copies the installer to `release-assets/official/` so it can be attached to a GitHub Release; it does not publish the release.
- The packaged app stores its SQLite database as `vesta.sqlite3` in the folder selected on first launch.

`npm run tauri dev` keeps the connected development workflow: it starts the API and Vite together, and API logs share that terminal. With the self-hosted console recovery fallback enabled, password reset URLs appear there under `[ADMIN ONLY]`.

## Project status

Email/password sign up, sign in, sign out, session lookup, and password reset use Better Auth. The server is Hono on Node.js and PostgreSQL persistence uses Drizzle migrations. See [authentication setup](docs/authentication.md) for self-hosted and cloud configuration.

In browser and connected development deployments, users sign in and workspace changes commit to an account-scoped IndexedDB replica before synchronizing with the authenticated PostgreSQL API. In packaged local desktop mode, no account or server is used: workspaces and preferences are stored in SQLite under the selected folder. Cloud-synced folders are not supported for the live SQLite database. The web shell caches visited application assets without caching API responses; Tauri loads the packaged shell directly. Task, document, and client features must add local persistence before appearing in the free desktop mode.

The selected web tooling is documented in [ADR 0001](docs/adr/0001-web-ui-tooling.md); desktop shell choices are in [ADR 0002](docs/adr/0002-desktop-shell.md), the connected local replica/sync contract is in [ADR 0005](docs/adr/0005-workspace-offline-replica-and-sync.md), and packaged setup and local storage are in [ADR 0006](docs/adr/0006-packaged-desktop-onboarding.md) and [ADR 0007](docs/adr/0007-local-desktop-storage.md).
