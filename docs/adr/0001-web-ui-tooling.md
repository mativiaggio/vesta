# ADR 0001: Web UI tooling

- Status: Accepted
- Date: 2026-10-20

## Context

The repository had no application scaffold. `AGENTS.md` requires a shared React UI for web and Tauri desktop, strict TypeScript, and shadcn/ui conventions. It also requires the build system and package manager to be selected and documented before introduction. The user delegated the choice according to `AGENTS.md`.

## Decision

Use Vite as the web UI build system and npm as the package manager. Implement the initial screen in React and TypeScript, with Tailwind CSS and shadcn/ui-compatible components. Keep the UI framework-neutral enough to be reused by a future Tauri 2 shell. The desktop shell, API framework, and backend deployment/build choices remain undecided and require their own ADRs before introduction.

## Consequences

- Web and desktop can share the same React screen and feature code.
- npm lockfile provides a reproducible dependency graph.
- This decision does not implement authentication, durable local storage, synchronization, or a server API.
- Future desktop and server decisions must respect deployment parity, offline-first, and persistence requirements in `AGENTS.md`.
