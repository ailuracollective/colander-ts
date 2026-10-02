# Add the @ailura/colander-web browser package

## Objective

Create a publishable web-facing package that abstracts browser-side loading and lifecycle around the main `@ailura/colander` package, and make the React example consume that package instead of owning a duplicate WASM adapter.

## Problem

The React example currently contains `wasm-colander-transport.ts`, which knows how to lazily load, cache, retry, recover, and adapt the packed Colander core. That behavior is useful outside React, but keeping it inside an example makes browser integration harder to reuse and duplicates the responsibility of a dedicated web package.

## Scope

- Add `examples/colander-web` as an isolated package named `@ailura/colander-web`.
- Make the new package depend directly on the main `@ailura/colander` package; it must not reimplement or copy the core.
- Expose a small async web client that loads the main package's core lazily, shares concurrent loads, retries failed loads, and preserves core error kinds and panic recovery.
- Keep the package browser-focused and free of React, NestJS, HTTP, TanStack Form, and renderer code.
- Make the React example depend on and use `@ailura/colander-web`; remove its local WASM adapter when the new package covers the behavior.
- Add package tests, README documentation, lockfile metadata, and focused React integration coverage.

## Constraints

- The main `@ailura/colander` package remains the only source of core operations and WASM bytes.
- The new package must preserve the main package's request/result types and `ColanderError` behavior.
- No network API/backend abstraction belongs in this package; browser WASM loading may use the same-origin asset behavior of the main package.
- Compiled `...Json` fields remain strings and are forwarded unchanged.
- Technical artifacts and UI copy remain in English.
- Ordinary functional verification is required; strict TDD is not configured.
- No commit, push, pull request, or remote operation is authorized.
- Existing unrelated worktree changes must be preserved.

## Authorized scope

The new isolated package, the React example's dependency/import/test wiring, relevant documentation/lockfiles, and this feature document may change. The root binding, NestJS app, and unrelated examples must not change.

## Delivery forecast

- Estimated authored change: approximately 350–550 lines across the new package, React integration, tests, and docs.
- Delivery strategy: `ask-on-risk`; no remote delivery action.
- Rollback boundary: remove the new package and restore the React example's previous direct adapter/dependency wiring; no root core changes are involved.

## Work units

- [x] **T1 — Create the web package boundary.** Added `examples/colander-web` with a direct `@ailura/colander` runtime dependency, `createWebColander`, `ColanderWebError`, publishable-style metadata, and browser-boundary documentation. Route: delegated writer; trigger: multiple new package files and public API decisions.
- [x] **T2 — Cover lifecycle and operations.** Added tests for shared lazy loading, rejected-load retry, panic recovery, exact request forwarding, structured errors, real packed-core identity/compile, and dependency boundaries. Route: delegated writer; trigger: package source plus focused tests.
- [x] **T3 — Integrate React.** Removed the React-local WASM adapter, added the local `@ailura/colander-web` dependency, normalized web errors, and retained a focused direct-client integration test. Route: delegated writer; trigger: dependency and runtime integration across packages.
- [x] **T4 — Verify and document.** Package, React, and transport checks pass; results are recorded below. Route: parent verification.

## Acceptance criteria

- `@ailura/colander-web` has a direct runtime dependency on `@ailura/colander`.
- The web client exposes core identity and all six operations with async browser-safe loading.
- Concurrent callers share one load; a rejected load can retry; a panic retires only the affected core.
- Main-package `ColanderError.kind` and request objects survive the boundary.
- The package has no React, backend, or duplicate WASM implementation dependency.
- React direct samples use the new package and no longer import the local WASM adapter.
- New package and React tests/builds pass; Vite still emits the main package's WASM asset.
- No commit, push, or remote operation is performed.

## Progress

- Feature document created before the first source write.
- Exploration route: CodeGraph plus a delegated read-only mapper.
- Implementation route: delegated direct writer for the new package and React integration.
- TDD mode: ordinary functional verification; no strict TDD evidence configured.
- Engram mirror: pending; parent memory tools are not exposed.

## Observed verification — 2026-09-24

- `pnpm --dir examples/colander-web install --frozen-lockfile` — passed.
- `pnpm --dir examples/colander-web typecheck` — passed.
- `pnpm --dir examples/colander-web test` — passed: 1 file, 7 tests.
- `pnpm --dir examples/colander-web build` — passed.
- `pnpm --dir examples/colander-web lint` — passed.
- `pnpm --dir examples/react-app install --frozen-lockfile` — passed.
- `pnpm --dir examples/react-app test` — passed: 4 files, 11 tests.
- `pnpm --dir examples/react-app build` — passed; Vite emitted the main package's `colander-*.wasm` asset. The expected `node:fs/promises` browser-externalization warning remains non-fatal.
- `pnpm --dir examples/react-app lint` — passed with six existing React/effect warnings.
- `pnpm --dir examples/colander-transport typecheck && pnpm --dir examples/colander-transport test && pnpm --dir examples/colander-transport build` — passed: 38 transport tests and the transport build.
- `pnpm --dir examples/colander-web pack --dry-run` — passed; the tarball contains only `dist`, `package.json`, and `README.md`, with no duplicate WASM payload.
- No commit, push, pull request, or remote operation was performed.
