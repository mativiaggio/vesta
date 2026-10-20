# ADR 0002: Desktop shell

- Status: Accepted
- Date: 2026-10-20

## Context

`AGENTS.md` requires React web and Tauri desktop to be first-class clients that share application logic and UI. The provided reference is a desktop window, so the initial sign in and sign up surface should run in both clients.

## Decision

Use Tauri 2 with the existing Vite + React + TypeScript frontend as the shared UI. Keep native commands and permissions minimal; this initial screen needs no filesystem, shell, or network plugin access. Rust/Cargo owns native builds. npm and Vite continue to own web dependencies and frontend builds.

## Consequences

- The same React screen runs in the browser and the desktop shell.
- The shell currently grants only Tauri's default core capability and does not expose filesystem or shell plugins.
- Desktop build availability depends on the platform's Tauri prerequisites.
- Authentication, durable local data, synchronization, and API services remain unimplemented and require separate design decisions.
