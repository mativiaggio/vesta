# Vesta

Vesta is a focused digital office for independent professionals. The initial shared React UI provides sign in and sign up screens.

## Development

- Install dependencies: `npm install`
- Copy `.env.example` to `.env`, set a 32+ character `BETTER_AUTH_SECRET`, and point `DATABASE_URL` at PostgreSQL.
- Apply the reviewed database migration: `npm run db:migrate`
- Start the desktop app, API, and web UI together: `npm run tauri dev`
- For web-only development, start the API with `npm run dev:server` and the web UI with `npm run dev` in separate terminals.
- Create the web build: `npm run build`
- Type-check the API: `npm run build:server`
- Build the desktop app: `npm run tauri -- build`

In desktop development, API logs share the terminal running `npm run tauri dev`. With the self-hosted console recovery fallback enabled, password reset URLs appear there under `[ADMIN ONLY]`.

## Project status

Email/password sign up, sign in, sign out, session lookup, and password reset use Better Auth. The server is Hono on Node.js and PostgreSQL persistence uses Drizzle migrations. See [authentication setup](docs/authentication.md) for self-hosted and cloud configuration.

After registration, users create their first workspace. Each workspace has a name, an accent color, and an identifying icon; returning users open the last workspace they used. Workspace selection and creation are handled by the authenticated server API and PostgreSQL. The workspace screen remains an early product surface while task, document, and client features are built.

The selected web tooling is documented in [ADR 0001](docs/adr/0001-web-ui-tooling.md); desktop shell choices are in [ADR 0002](docs/adr/0002-desktop-shell.md).
