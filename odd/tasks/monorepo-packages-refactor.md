# Refactor the repository into a Colander package monorepo

## Objective

Convert the repository into a pnpm monorepo with three packages:

- `packages/colander` — the existing main WebAssembly/TypeScript wrapper.
- `packages/colander-browser` — the browser lifecycle wrapper around `colander`.
- `packages/colander-client` — the renamed/moved source-agnostic transport and form-model package.

The examples remain behaviorally unchanged. Only the React reference/import to the renamed client package may change, plus the temporary web-package extraction must be reverted from the examples.

## Problem

The repository currently mixes a publishable main package at the root, isolated example packages, a temporary `examples/colander-web` extraction, and an isolated `examples/colander-transport` package. The target architecture needs a root workspace with stable package ownership and clear dependency direction:

```text
colander-browser -> colander
colander-client   (source-agnostic; no core dependency)
colander          (core implementation and WASM)
```

The examples should continue demonstrating the same behavior, not be rewritten as part of the monorepo move.

## Authorized scope

- Root workspace manifests, lockfile, orchestration scripts, and package-local build/test configuration.
- Move the current main binding into `packages/colander`.
- Move `examples/colander-transport` into `packages/colander-client` and rename its package identity to `@ailura/colander-client`.
- Move the temporary `examples/colander-web` implementation into `packages/colander-browser` and rename it to `@ailura/colander-browser`.
- Revert the temporary React web-package integration and restore the pre-extraction React-local direct adapter.
- Update only the React import/dependency/lockfile references required by the client rename.
- Update root/package READMEs and this feature document.
- Do not change Nest routes, React application behavior, sample definitions, or unrelated example files.

## Constraints

- Examples must remain behaviorally unchanged. Allowed example edits are limited to package import/dependency/lockfile references required by the client move.
- `packages/colander-browser` must depend directly on `@ailura/colander` using the root workspace protocol; it must not depend on `colander-client`, React, HTTP, or duplicate the core.
- `packages/colander-client` remains source-agnostic and must not depend on the core or a concrete browser/backend transport.
- The main package remains the only owner of `wasm/colander.wasm` and the `colander.load()` implementation.
- Compiled `...Json` fields remain strings and are forwarded unchanged.
- The root `vite.config.ts` is a pre-existing uncommitted change; preserve its example exclusions unless a package-local configuration makes a change unavoidable and documented.
- No `git reset`, `git clean`, broad deletion, commit, push, pull request, or remote operation.
- Technical artifacts and documentation remain in English.
- Strict TDD is not configured; ordinary functional checks are required.

## Delivery forecast

- Estimated authored change: approximately 500–900 lines of moved/configured code plus regenerated lockfiles and documentation. Generated `dist`, `node_modules`, and tarball contents are excluded from the authored count.
- Delivery strategy: `ask-on-risk`; no PR or push is authorized.
- Rollback boundary: restore the root package files, the two isolated example package directories, and the pre-extraction React adapter/dependency wiring; do not reset unrelated worktree files.

## Work units

- [x] **T1 — Restore the example boundary.** Removed the temporary React web-package integration, restored the pre-extraction local WASM adapter/tests and direct dependency, and preserved the hard samples/HTTP/native runner work. Only the later client reference update remains for examples. Route: delegated writer; trigger: provenance-sensitive multi-file restoration.
- [x] **T2 — Establish the root workspace and main package.** Moved the root wrapper into `packages/colander`, created a private workspace root, added package-local Vite+/TypeScript configuration, recalculated sibling-vector discovery, and regenerated the root lockfile while preserving example exclusions. Route: delegated writer; trigger: root/package boundary and path-sensitive build changes.
- [x] **T3 — Move and rename the client package.** Moved transport into `packages/colander-client`, renamed it `@ailura/colander-client`, preserved contracts/helpers/tests/calculated-answer filtering, and updated only React technical references and lockfile data. Route: delegated writer; trigger: cross-package source and dependency move.
- [x] **T4 — Move the browser package.** Moved the temporary web implementation into `packages/colander-browser`, renamed it `@ailura/colander-browser`, switched the main dependency to `workspace:*`, and removed nested workspaces/lockfiles. Route: delegated writer; trigger: package move and dependency-boundary change.
- [x] **T5 — Verify the monorepo.** Root install/build/typecheck/lint/checks, all package typechecks/builds/lints, client/browser tests, React and Nest checks, frozen example installs, pack dry-runs, and the allowlisted path scan were run. The main package's four frozen-vector count failures remain the pre-existing sibling-corpus mismatch. Route: parent verification plus bounded command workers.

## Acceptance criteria

- Root `pnpm-workspace.yaml` includes exactly the three package workspaces under `packages/*` and keeps examples isolated.
- `packages/colander` retains the main package contract, WASM asset, public API, tests, and sibling-vector discovery.
- `packages/colander-client` is named `@ailura/colander-client`, retains the transport/form-model API and calculated-answer filtering, and has no core dependency.
- `packages/colander-browser` is named `@ailura/colander-browser`, directly depends on `@ailura/colander` through the workspace, and contains no duplicate core implementation.
- React source/application behavior is unchanged except the approved client import/dependency path; the temporary web package is gone from `examples`.
- Root and package lockfiles install with `--frozen-lockfile`; package builds/tests/lints pass, main is built before browser, and the packed browser archive contains no duplicate WASM.
- Nest and unrelated example behavior remain green.
- No commit, push, or remote operation is performed.

## Progress

- Feature document created before the first source write for this refactor.
- Provenance exploration completed with CodeGraph and a read-only mapper.
- The temporary web extraction is explicitly in scope for removal from examples; pre-existing native/HTTP/sample work is protected.
- TDD mode: ordinary functional verification; no strict TDD evidence configured.
- Engram mirror: pending; parent memory tools are not exposed.

## Observed verification — 2026-09-24

- `PNPM_CONFIG_OFFLINE=true pnpm install --frozen-lockfile` — passed for the root workspace.
- `pnpm run build`, `pnpm run typecheck`, and `pnpm exec vp check` — passed; root Vite+ formatting/lint/type checks passed after package-local config exclusions were applied.
- `pnpm --filter @ailura/colander typecheck`, `lint`, and `check` — passed; `build` — passed.
- `pnpm --filter @ailura/colander test` — 13 binding tests passed; four frozen-vector count assertions failed against the existing sibling corpus (`6/5`, `59/61`, `8/6`, `38/34`). The same mismatch was recorded before this refactor and is not caused by the package move.
- `pnpm --filter @ailura/colander-client typecheck`, `test` (38), `lint`, and `build` — passed.
- `pnpm --filter @ailura/colander-browser typecheck`, `test` (7), `lint`, and `build` — passed; its `workspace:*` dependency is resolved from the main package.
- Main and browser pack dry-runs passed with lifecycle scripts disabled where needed; the browser archive contains no duplicate WASM payload.
- React frozen install, 16 tests, production build, and lint passed; lint retains six pre-existing warnings and the expected `node:fs/promises` browser externalization warning.
- Nest unit tests (7) and e2e tests (5) passed unchanged.
- `git diff --check` passed; `examples/` contains only `nest-app` and `react-app`; no old package directories or active stale client/web package references remain.
- Native RDD candidate review was offered for the selected monorepo worktree and explicitly declined by the user. No review receipt or approval was created; ordinary checks remain the verification of record.
- No commit, push, pull request, or remote operation was performed.
