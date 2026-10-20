# Vesta — Agent Engineering Instructions

> These instructions are mandatory for every AI coding agent and contributor working in this repository. They apply to all packages, applications, modules, migrations, tests, and scripts. If a task conflicts with them, explain the conflict and propose a compliant solution instead of silently bypassing a rule.

## 1. Product mission

Vesta is a distraction-free digital office for independent professionals. No corporate bloat, no engagement hooks, and no bullshit. Just a lightning-fast, offline-first workspace combining minimal tasks, clean docs, and streamlined client sharing. Built to get users out of the app and back to their actual billable work.

Every technical and product decision must support simplicity, reliability, privacy, portability, and exceptional perceived performance. Do not introduce engagement mechanics, unnecessary configuration, intrusive notifications, or complexity without a concrete user benefit.

## 2. Non-negotiable principles

1. **One product, two deployment modes:** Vesta is free and open source, self-hostable, and also offered as a managed paid cloud service. Both modes use the same core product and feature implementations. Never fork business logic by deployment mode.
2. **Feature parity by default:** A core feature must work in self-hosted and managed deployments. Optional infrastructure may change the implementation, never silently remove the feature. If a feature genuinely requires external infrastructure, design and document an explicit portable alternative or flag the requirement before implementation.
3. **Offline-first, not merely offline-tolerant:** Supported core workflows remain usable without a network connection. Local writes must be durable, queue for synchronization, and reconcile safely when connectivity returns. Do not call a feature offline-capable until its offline behavior is implemented and tested.
4. **Persist user information:** User-created and user-modified information must survive application and device restarts. Domain data belongs in a defined durable store; React state, memory-only caches, and browser localStorage are not authoritative persistence mechanisms.
5. **Strict modularity:** Organize by business feature and responsibility. Keep public interfaces explicit, dependencies directed, and components focused. Do not grow catch-all files or directories.
6. **Senior-level engineering:** Prefer straightforward, typed, testable, maintainable implementations over clever abstractions or shortcuts. Do not introduce needless patterns, dependencies, duplication, or speculative generalization.
7. **Rules apply globally:** Cross-cutting standards must hold for every applicable module and database entity. Implement enforcement mechanisms and regression tests rather than relying only on convention.
8. **Secure by default:** Enforce authorization, least privilege, input validation, tenant isolation, safe filesystem access, and secure handling of secrets in both deployment modes.
9. **Web and desktop together:** Treat React web and Tauri desktop as equally important first-class clients. Share application logic and components where appropriate, isolate platform-specific integrations, and test both surfaces.
10. **Performance is a requirement:** Optimize cold start, interaction responsiveness, database operations, sync efficiency, bundle size, and memory usage. Measure before claiming improvement.

## 3. Required technology and boundaries

- Language: TypeScript with strict compiler checks for application and backend code; Rust for Tauri native functionality.
- UI: React, Tailwind CSS, shadcn/ui and its composition conventions.
- Desktop: Tauri 2 with a shared React UI.
- Server database: PostgreSQL; use Drizzle ORM for schema definitions, typed queries, and migrations.
- Web: React application consuming the same documented application API as desktop.
- Server: a TypeScript API/service layer. The HTTP framework, package manager, build system, and deployment framework must be selected and documented in an Architecture Decision Record (ADR) before introduction; do not assume unstated stack choices.
- Offline local storage: use a durable local database suitable for each platform. Recommended: SQLite through a controlled Tauri/Rust adapter on desktop, and IndexedDB through a typed adapter on web. This recommendation is not an authorization to bypass the repository's chosen architecture.
- PostgreSQL is the server-side source of truth after synchronization; local databases store durable working replicas and pending mutations. Never expose database credentials or connect directly to PostgreSQL from an untrusted browser or Tauri frontend.

## 4. Deployment parity and infrastructure abstraction

Model deployment mode as configuration, **not** as a collection of `if (isCloud)` checks across product code. Implement capabilities behind well-defined interfaces, register implementations at the composition root, and keep domain/application modules unaware of provider names.

Each integration must define a provider-neutral contract, a production-capable implementation, a self-host-friendly implementation, configuration validation, failure semantics, observability, and tests covering both implementations. External managed services must remain optional for core product functionality unless a product requirement explicitly says otherwise.

### Email and password recovery

Define an `EmailDelivery` (or equivalent) interface. With a configured provider such as Resend, send password reset messages using that provider. Without email configuration, the self-hosted server may emit a one-time reset URL to its **server-side administrative console/log** when explicitly enabled for trusted local administration. Do not print tokens to the browser console, send them to general application logs, or enable this fallback in managed production. Mask sensitive data in routine telemetry, restrict access to administrative logs, and document the exposure risk. Reset tokens must expire, be single-use, and be stored as hashes. Never silently claim delivery if only a console URL was emitted. Managed cloud deployments must require a real delivery provider for password recovery.

### File attachments

Define a `BlobStorage`/`FileStorage` interface supporting upload, read, delete, metadata, and safe access control. Support an S3-compatible object-storage adapter (including AWS S3) and a local-filesystem adapter. Self-hosters may select a writable directory through server configuration or an authenticated admin-only settings UI; validate it server-side, enforce permitted roots, and prevent path traversal. A browser must never select a folder on its own machine as if it were a server directory. Store metadata and relationships in PostgreSQL, and bytes in the configured storage backend; never place large file blobs directly into ordinary domain tables. The selected backend must not alter how attachments appear to users. Define lifecycle behavior for deleted attachments, backups, quota limits, and migration between backends.

### Further integrations

Apply the same pattern to background jobs, scheduling, telemetry, notifications, search, and other third-party infrastructure. Core behavior must not depend on a proprietary provider when a reasonable portable implementation exists. Cloud operational services (billing, deployment control plane, infrastructure monitoring) must remain outside domain feature logic.

## 5. Repository architecture and ownership

Prefer a monorepo with explicit package boundaries. This is a recommended starting layout; adjust names to existing repo conventions while preserving the same separation of concerns:

```text
apps/
  web/                         # Browser entry point, routes, application shell
  desktop/                     # Tauri desktop entry point and native Rust code
  server/                      # HTTP API, application composition, workers
packages/
  ui/                          # Shared design system and shadcn/ui primitives
  domain/                      # Domain entities, rules, types, contracts
  application/                 # Use cases, orchestration, permissions
  api-contract/                # Validated request/response contracts
  database/                    # PostgreSQL Drizzle schema, migrations, repositories
  sync/                        # Offline operation model, reconciliation, sync contracts
  integrations/                # Email, file storage, and other provider adapters
  config/                      # Validated config schemas and shared tooling
  features/
    tasks/
    documents/
    clients/
    sharing/
    auth/
    settings/
```

Within each feature, split files only along meaningful responsibilities: `components/`, `hooks/`, `application/`, `domain/`, `data/`, `schemas/`, `tests/` where necessary. Modules own their feature-specific behavior and expose a small public API. Shared UI primitives belong in `packages/ui`, not a feature folder. Cross-feature reusable business logic belongs in a deliberately named shared module, not an unbounded `utils` dumping ground.

Dependency direction: platform apps → features/application → domain contracts; infrastructure adapters implement contracts and are injected at the composition root. UI components must not access Drizzle, environment variables, provider SDKs, raw file paths, or platform-native APIs directly. Prevent circular imports and imports into another module's private internals. Avoid a single gigantic `components`, `services`, `helpers`, `index.ts`, or route file.

## 6. Database and persistence invariants

**All application-owned persistent relational records must use soft deletion, never direct physical deletion in normal product flows.** This includes association/join records, as applicable. Every relevant table must contain `created_at`, `updated_at`, and nullable `deleted_at` fields with consistent semantics; define stable identifiers and indexes appropriate to each entity. Schema metadata and migration bookkeeping owned by third-party tooling are not application domain records. Physical purge is a separate, explicitly authorized data-retention operation and must not be used as the regular delete pathway.

- Define schemas and migrations via Drizzle. Never modify a deployed database schema through ad hoc SQL outside reviewed migrations.
- Queries must exclude soft-deleted records by default, including relations, list counts, authorization lookups, and search. Expose inclusion/restoration only through explicit named operations.
- Implement common schema fields and repository-level helpers so soft-delete behavior is not re-created inconsistently. Verify invariants with automated schema and repository tests.
- Plan uniqueness constraints with soft deletion in mind (for example, PostgreSQL partial unique indexes where appropriate).
- All writes go through validated use cases, transactions when needed, and correctly authorized repository methods. Never let clients choose tenant/workspace ownership fields they are not entitled to set.
- Persist user preferences, settings, task state, documents, sharing state, attachment metadata, and other business state in the appropriate durable store. Keep ephemeral hover/animation state in memory.
- Use UTC timestamps, explicit migrations, strong constraints, pagination, and properly indexed hot queries. Avoid unbounded queries and N+1 patterns.
- Changes to global data conventions require coordinated schema, application, API, sync, and test updates.

## 7. Offline-first and synchronization contract

Design local persistence and sync as first-class modules, not a retrofit. For every mutation, specify local durability, queue format, retry behavior, server acknowledgment, idempotency, conflict handling, and eventual consistency. Every mutable synced record needs stable IDs, timestamps, and an explicit version/change-tracking mechanism appropriate to the domain. A generic `updated_at` timestamp alone is insufficient as a conflict-resolution protocol.

Support app restart, lost connectivity, retries, duplicate requests, multiple devices, server-side soft deletes, and partial failures. Make pending/synced/error states truthful and unobtrusive. Acknowledge a write as locally saved only after it is durably committed; acknowledge server synchronization only after server confirmation. Do not discard unsynced mutations on logout, navigation, crashes, or upgrades without an explicit recovery policy.

Define conflicts by entity type: task field updates may follow deterministic merge/version policies; document edits may need a stronger model. Do **not** introduce CRDTs, operational transforms, or last-write-wins globally without evaluating their requirements and documenting the choice. Design tenant-safe sync endpoints and minimize payloads. Attachment uploads need offline metadata/pending-upload handling and explicit retry semantics.

## 8. UI design and shadcn/ui rules

All standard UI controls **must use shadcn/ui components** when an appropriate component exists. Check available shadcn components before creating a new control. New controls must be composed from shadcn primitives and follow its conventions for styling, accessibility, variants, keyboard support, and predictable behavior. Create a completely custom primitive only if shadcn provides no suitable base; document the reason. Do not casually introduce a competing component library.

UI direction: minimal, polished, calm, compact, desktop-quality, inspired by the restraint and focus of Antigravity Desktop and Codex Desktop, without copying proprietary assets. Favor clear hierarchy, strong typography, restrained colors, subtle borders, consistent spacing, and high information density without clutter. Avoid decorative dashboards, gimmicky animation, excessive shadows, engagement prompts, visual noise, and unnecessary modals.

**Control density is a global design rule.** Default to delicate, compact controls inspired by Codex Desktop: selects and toolbar controls around 32–36px tall; form inputs and primary buttons around 38–40px; control text around 12–14px; restrained horizontal padding, subtle 1px borders, and modest corner radii. Keep general UI copy compact as well, while preserving clear heading hierarchy and readable body text. Increase dimensions only when a specific interaction or accessibility need calls for it; do not make controls feel heavy through oversized type, height, padding, or spacing.

**Internationalization is a global UI requirement.** All user-facing interface copy, accessible names, validation feedback, empty/loading/error states, and emails shown in the client must come from the shared localization feature. The initial supported languages are English and Spanish. Use its typed translation API and language selector; do not add hardcoded copy to a new screen. Preserve the selected language across restarts, initialize from the browser language when no preference exists, and keep the document `lang` attribute synchronized. Use `Intl` APIs with the active language for dates, numbers, and other locale-sensitive values. New user-facing copy must be added to every supported language together.

Preserve accessibility: semantic markup, focus visibility, keyboard navigation, appropriate contrast, ARIA only when necessary, and reduced-motion preferences. Design responsive browser layouts and native-feeling desktop interactions with the same feature capabilities. Keep UI state minimal; derive rather than duplicate state. Do not trigger expensive renders or network round trips for every keystroke.

## 9. TypeScript, React, Rust, and code quality

- Keep TypeScript strict; avoid `any`, unsafe type assertions, ignored compiler errors, and unchecked external data. Validate external inputs at boundaries with a shared schema strategy.
- Prefer small, cohesive functions; explicit names; readable control flow; and composition. Avoid premature abstractions and enormous hooks, reducers, services, or components.
- Separate presentation, stateful orchestration, business rules, persistence, and provider adapters. No business rules embedded inside JSX event handlers.
- Use error types/results consistently; never swallow exceptions or report success before durable completion.
- Make async work cancellable or safe against unmount/navigation where relevant. Avoid race conditions and duplicate requests.
- In Rust/Tauri, expose minimal reviewed commands, validate arguments, restrict capabilities, and never grant unrestricted filesystem or shell access.
- No hardcoded secrets, access tokens, credentials, private URLs, or environment-specific paths in source control. Provide documented environment examples and startup validation.
- Do not add a dependency until verifying that an existing one or platform capability cannot solve the problem simply. Maintain license compatibility with the open-source project.
- Document non-obvious design decisions, not trivial code. Avoid unnecessary comments and dead code.

## 10. Security and multi-tenancy

Authentication is not authorization. Authorize every server operation and every resource lookup. Treat all web/desktop clients as untrusted. Scope database queries, sync feeds, attachments, and sharing links to the authenticated principal and its permitted workspace/tenant. Never trust a client-supplied `tenant_id` or ownership claim without server verification. Use secure sessions/token lifecycles, input limits, rate limiting where necessary, CSRF protection where relevant, and safe share-token generation/expiry/revocation.

Hosted-cloud tenant isolation is mandatory, even if a self-hosted instance initially serves a single organization. Self-hosted operation must not require contacting Vesta's managed cloud for activation or core functionality. Separate operational billing/admin functionality from application data. Document backups, restores, configuration ownership, and secret handling for both modes. No user data should be sent to analytics, monitoring, or external AI services without an explicit product requirement and suitable consent/settings.

## 11. Performance budgets and verification

Performance must be designed and measured, not asserted. Define measurable budgets in project documentation for startup, interaction latency, typical query latency, bundle size, memory usage, and synchronization. Record baselines on representative hardware and network conditions. Avoid unnecessary backend calls, heavyweight packages, blocking startup tasks, uncontrolled React rerenders, eager loading of rarely used features, oversized SQL queries, and inefficient polling. Use lazy loading, indexing, batching, virtualization, and background work when evidence justifies them. Preserve correctness over micro-optimizations.

## 12. Testing and delivery requirements

Each meaningful feature needs automated coverage at the appropriate boundaries: unit tests for domain rules, integration tests for Drizzle repositories/migrations and infrastructure adapters, API authorization tests, offline/sync resilience tests, and UI tests for significant workflows. Run relevant lint, formatting, type checks, tests, and builds before calling work complete.

Test both deployment modes for feature parity and both client surfaces where behavior may differ. Verify email provider versus secure administrative fallback; S3-compatible versus filesystem storage; online versus offline mutations; retry/idempotency/conflict behavior; soft deletion/restoration; tenant isolation; accessibility; and failure handling. Add regression tests whenever fixing a bug. Do not mark unfinished code as production-ready or hide incomplete work behind optimistic language.

## 13. Required agent workflow

Before changing code, inspect the existing repository structure, local conventions, relevant modules, schemas, tests, and configuration. Do not invent APIs or overwrite established architecture. For substantial work, give a concise implementation plan and identify the affected modules and contracts.

When implementing a feature, explicitly evaluate: domain model, database migration, API contract, authorization, self-hosted deployment, managed deployment, web, desktop, offline storage, synchronization, shadcn/UI composition, error states, and tests. Apply only the portions that are relevant, but never silently ignore a relevant surface.

After implementation, report what changed, which checks passed, any checks not run, outstanding risks, and any deliberate deviations. If a rule must be changed, propose a change to this file or an ADR first; do not establish a conflicting pattern inside an individual feature.

## 14. Definition of done

A feature is complete only when it is modular, fully typed, persisted correctly, authorized, accessible, covered by appropriate tests, and usable in both self-hosted and managed deployments. It must work on web and desktop wherever applicable, and honor the promised offline behavior. It must use shadcn/ui conventions, preserve global database invariants, avoid unnecessary dependencies and product clutter, and meet documented performance expectations.

**Do not trade away these properties to finish a task faster.** When full delivery is not feasible, clearly distinguish an incomplete increment from a completed feature.
