# Performance budgets

Vesta treats perceived speed as a product requirement. The production web build currently enforces an initial JavaScript budget of **220 KiB gzip** with `npm run check:performance`. Route-level workspace and authentication code stays lazy-loaded.

The next representative-hardware baseline must record:

- web cold start to usable authentication screen: target under 1.5 seconds on a mid-range laptop and broadband connection;
- desktop cold start to usable cached workspace: target under 1 second on supported hardware;
- local interaction response: target under 100 ms;
- typical indexed workspace query and server query: target under 100 ms at p95;
- idle desktop memory: target under 150 MiB;
- sync batches: cursor-paginated, at most 50 workspaces per response, with idempotent mutation retries.

Bundle size is checked in CI. Runtime timings require representative hardware and must be recorded before a release claim; development-machine observations are not release evidence.
