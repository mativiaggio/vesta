# Authentication setup

These instructions apply to browser deployments, self-hosted deployments, and `npm run tauri dev`. Packaged desktop builds use the free local mode and do not require an account, authentication server, or PostgreSQL.

Vesta uses Better Auth for email/password registration, sign in, database-backed sessions, sign out, and password recovery. The web and Tauri clients use the same API. The API validates every configured origin and uses credentialed CORS; wildcard origins are not supported.

The shared Better Auth adapter soft-deletes identity, session, account, and verification rows, filters deleted rows from reads and writes, and consumes one-time verification rows atomically. Better Auth rate-limit rows are ephemeral operational data and are physically deleted by its retention path so throttling cannot create an ever-growing soft-delete history. Authentication throttles are stored in PostgreSQL so limits hold across server replicas. Workspace mutations use a separate portable PostgreSQL limiter with hourly and daily per-user windows consumed atomically; the middleware fails closed if shared protection is unavailable. `GET /api/me` and the workspace routes require a server-validated session. Workspace reads and activation are scoped through the signed-in user's active membership; clients cannot submit ownership IDs. Unsafe workspace requests additionally require an exact trusted `Origin` before session or database work begins. Cookies are HTTP-only and Secure with `SameSite=None` so the Tauri webview can call a separately hosted API; Better Auth's trusted-origin checks and exact CORS allowlist remain enabled. Cloud API URLs must use HTTPS.

## Self-hosted

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, generate a unique `BETTER_AUTH_SECRET` with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`, and set `BETTER_AUTH_URL` to the API's public URL.
3. Set `AUTH_TRUSTED_ORIGINS` to the exact web and desktop origins. The defaults cover Vite on `localhost:5173` and Tauri's Windows and macOS/Linux development origins. Add the packaged app origin if it differs.
4. Run `npm run db:migrate`. For desktop development, `npm run tauri dev` starts the API and Vite together; API logs, including explicitly enabled administrative recovery URLs, appear in that terminal. For web-only development, run `npm run dev:server` and `npm run dev` in separate terminals.
5. For recovery, configure Resend or explicitly set `ENABLE_CONSOLE_PASSWORD_RESET=true` on a trusted self-hosted instance.

The console fallback writes the one-time recovery URL to the server process's **administrative stderr console**. Enable it only where access to that console is restricted. Do not forward this output to general application logs, browser logs, shared build logs, or external telemetry. Reset URLs expire after one hour and are single-use; Better Auth stores the reset identifier hashed, and a successful reset revokes existing sessions. If no delivery path is configured, the request fails rather than claiming delivery. Provider-delivered messages use the English or Spanish language selected by the requesting client.

Serve remotely accessible self-hosted instances over HTTPS; local development may use `localhost` HTTP.

## Managed cloud

Set `DEPLOYMENT_MODE=cloud`, `RESEND_API_KEY`, `EMAIL_FROM`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and the exact allowed origins. Cloud startup validation rejects missing Resend credentials and rejects the administrative console fallback. The same Better Auth routes and UI are used in both deployment modes.

## Offline identity boundary

After a successful online session, the client stores only the user's non-credential identity (`id`, display name, email, optional image) in IndexedDB. This allows the same browser profile or desktop installation to open that user's already-replicated workspace data while offline. It is not a replacement credential and never authorizes server requests; synchronization still requires the server session. Signing out clears the cached identity while preserving unsynchronized per-user mutations for recovery. The service worker caches same-origin application-shell GET responses but explicitly excludes `/api/`.

Registration is public and creates the identity. Email verification is not enabled in this iteration.

Run schema changes through Drizzle Kit (`npm run db:generate`) and review the generated migration before committing it. Apply committed migrations with `npm run db:migrate`; production startup does not create tables automatically.
