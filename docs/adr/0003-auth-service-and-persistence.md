# ADR 0003: Authentication service and persistence

- Status: Accepted
- Date: 2026-10-20

## Context

Vesta needs the same email/password authentication flow in the browser and Tauri desktop, with durable accounts and sessions, password recovery, and provider-neutral email delivery. `AGENTS.md` requires Better Auth, PostgreSQL with Drizzle, deployment parity, and an ADR before selecting a server framework.

## Decision

- Use a Node.js 22+ TypeScript server with Hono and `@hono/node-server`.
- Use Better Auth for signup, sign-in, session handling, sign-out, and password reset. Both clients call the same `/api/auth` endpoints over HTTPS in production.
- Use PostgreSQL through Drizzle ORM and versioned Drizzle Kit migrations. The API does not connect to PostgreSQL from the client.
- Use Resend behind a provider-neutral `EmailDelivery` contract. Cloud mode must configure Resend at startup. Self-hosted mode may opt into emitting a reset URL to its restricted server administration console; it is disabled by default.
- Accept configured browser and Tauri origins, with credentialed CORS and Better Auth origin validation. No wildcard credential origins.
- Public email/password registration creates an identity; the authenticated first-run flow then creates the user's first workspace.

## Consequences

- Self-hosted operators need PostgreSQL, a Better Auth secret, and an API URL. Password recovery requires either Resend or the explicitly enabled administrative-console sink.
- Managed deployments cannot start without Resend credentials and a sender address.
- Password reset links and verification data are handled server-side; reset tokens are not returned to the client or routine logs.
- This ADR selects the server framework and auth persistence only. It does not select a deployment provider, local offline database, or synchronization protocol.
