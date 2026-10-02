# Migrate the React example to TanStack Start SSR

## Objective

Replace the Vite SPA entry in `examples/react-app` with a TanStack Start application that renders the Colander form runner through the Start SSR lifecycle while preserving the existing HTTP/WASM sample selection and browser behavior.

## Problem

The current React example mounts `App` directly from `index.html` through `createRoot`. It has no router, server entry, route tree, or SSR proof. The application must move to TanStack Start without executing browser-only APIs during the server render.

## Authorized scope

- `examples/react-app` package metadata, lockfile, Vite/TypeScript configuration, route/root/router entries, SSR test, and technical documentation.
- Preserve the existing `App` UI, sample definitions, HTTP transport, direct WASM transport, and client package dependencies.
- Add only the TanStack Start/Router dependencies and generated route-tree artifacts required by the migration.
- Do not change `packages/colander`, `packages/colander-client`, `packages/colander-browser`, or the Nest example.

## Constraints

- SSR must not call `colander.load()` or access `window`/`document` during render.
- The default sample's WASM compilation remains a client-side capability; SSR must provide a stable HTML shell and hydrate the existing interactive workflow.
- Preserve the `/api` proxy behavior for the Nest example.
- No reset, clean, commit, push, PR, or remote operation.
- Technical artifacts remain in English.
- Strict TDD is not configured; ordinary functional checks and an SSR proof are required.

## Delivery forecast

- Estimated authored change: approximately 150–300 lines plus generated route-tree/lockfile data.
- Delivery strategy: `ask-on-risk`; no PR or push is authorized.
- Rollback boundary: restore the React Vite entry/config and remove only the TanStack route/SSR files and dependencies.

## Work units

- [x] **T1 — Establish the Start application boundary.** Add Start/Router dependencies, configure the Vite plugin and SSR build, replace the SPA entry with a root route and router, and generate the route tree. Route: delegated writer; trigger: multi-file framework migration.
- [x] **T2 — Preserve the interactive form.** Mount the existing `App` through the Start index route and make the root document/style boundary SSR-safe without changing source-selection behavior. Route: delegated writer; trigger: cross-boundary React/SSR behavior.
- [x] **T3 — Prove SSR and client behavior.** Add a server-render test, run frozen install, typecheck, tests, lint, and production build, and record any known warnings or pre-existing failures. Route: bounded verification worker plus parent readback.
- [x] **T4 — Evaluate rules only on submit.** Stop scheduling `evaluateRules` from every answer change, keep controlled input values local, and run rule evaluation before response validation when the form is submitted. Route: delegated writer; trigger: non-trivial interaction lifecycle change.

## Acceptance criteria

- The React example uses TanStack Start's documented route/root/router structure and no longer mounts the app from `index.html`/`src/main.tsx`.
- A server render of the index route completes without browser-global or WASM initialization errors.
- The browser build hydrates the existing form runner and retains HTTP/WASM sample selection.
- Typing updates the local form without issuing `evaluateRules`; submission evaluates current rules before calling `validateResponse`.
- React tests, typecheck, lint, and production build pass, or any environmental failure is explicitly recorded.
- The four pre-existing main-package frozen-vector count failures are not changed or treated as caused by this feature.
- No commit, push, pull request, or remote operation is performed.

## Progress

- Feature document created before the first source write for this migration.
- CodeGraph exploration and official TanStack Start documentation review completed.
- TDD mode: ordinary functional verification; no strict TDD evidence configured.
- Engram mirror: pending; memory tools are not exposed in this runtime.
- Added `@tanstack/react-start` `1.168.56` and `@tanstack/react-router` `1.170.38`; the lockfile resolves the compatible cached `prettier` `3.9.8` required by the router generator.
- Added the Vite Start plugin, root document route, index route, router factory, and generated `src/routeTree.gen.ts`; removed the obsolete SPA `index.html` and `src/main.tsx` entry.
- Added `src/ssr.test.ts` using the Start render handler and a Node-only `Request`; it checks the app shell, browser-global absence, and that `colander.load()` was not called.
- T4 implemented: `FormRunner` now keeps answer edits in TanStack Form without scheduling rule evaluation, invalidates stale evaluations, evaluates the submitted answers before response validation, applies calculated/rule state, and falls back to local answers when evaluation fails.
- Added the Node/Vitest submit-order fallback coverage in `src/lib/form-values.test.ts` and the focused `src/lib/form-submission.ts` helper.

## Verification evidence

- `PNPM_CONFIG_OFFLINE=true pnpm --dir examples/react-app install --frozen-lockfile` — passed; resolution skipped and no package download occurred.
- `./node_modules/.bin/tsc -b` — passed; no `typecheck` script is defined, and the production build runs the same check.
- `PNPM_CONFIG_OFFLINE=true pnpm --dir examples/react-app test:ssr` — passed: 1 file, 1 test.
- `PNPM_CONFIG_OFFLINE=true pnpm --dir examples/react-app test` — passed: 5 files, 17 tests.
- `PNPM_CONFIG_OFFLINE=true pnpm --dir examples/react-app lint` — passed with warnings: existing UI/App effect warnings plus two `react/only-export-components` warnings in the generated-style root route.
- `PNPM_CONFIG_OFFLINE=true pnpm --dir examples/react-app build` — passed; client and SSR bundles were emitted.
- Before the later concurrent package changes, T4 follow-up checks from `examples/react-app` passed: `./node_modules/.bin/tsc -b` — passed; `./node_modules/.bin/oxlint` — passed with 8 warnings (five `react/only-export-components`, two App `react(set-state-in-effect)`, and one FormRunner `react(set-state-in-effect)`). The exact offline `PNPM_CONFIG_OFFLINE=true pnpm test` and `PNPM_CONFIG_OFFLINE=true pnpm build` retries were blocked by pnpm's pre-run dependency verification attempting to resolve the local Colander package in offline mode; rerunning with `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` passed: 5 files, 18 tests, and client/SSR build output, respectively. The build retained the `node:fs/promises` browser-externalization warning.
- A later verification rerun was affected by concurrent unrelated package changes: `tsc -b` reported package-contract errors in `App.tsx`, `api.ts`, HTTP transport, and missing `@ailura/colander-browser`; the offline build stopped at the same type errors, and two Vitest suites failed to import that unrelated package while the focused form-values test remained passing. No unrelated package or transport files were changed to address this state.
- `pnpm dev --host 127.0.0.1` plus a local `curl http://127.0.0.1:5173/` — passed: the live dev server returned the Start document, app shell, and hydration marker with HTTP 200.
- WASM triage: the installed core and `@ailura/colander-browser` were present, but Vite's dependency prebundle referenced an older package generation. `vite --force` regenerated it; browser-equivalent `loadBundledWasm` then returned ABI 1 / Colander 0.1.0, `tsc -b` passed, Vitest passed (6 files, 31 tests), and the client/SSR build passed. Existing dev servers must be restarted to load the regenerated prebundle.
- `node --input-type=module -e "import server from './dist/server/server.js'; ..."` — passed: built Start handler returned HTTP 200, `text/html`, the app shell, and Start hydration/module scripts without a WASM-loading marker.
- Build warning: Vite externalizes `node:fs/promises` from the packed Colander package for browser compatibility; the browser still emits the packed WASM asset, and the existing direct-WASM tests pass.
- One exploratory `pnpm exec vite build` invocation triggered pnpm's registry policy warnings before the build; it was not used for dependency installation, and all subsequent install/lockfile and verification commands used offline mode.
- Native RDD assessment returned `high`/`unassessable` because the workspace contains prior untracked files. The canonical STATUS then required an `external.select_intended_untracked` binding without an executable native continuation. The user chose to continue without reporting; no GitHub operation or review receipt was created. Ordinary checks remain the verification of record.
- No commit, push, pull request, reset, clean, or remote git operation was performed; the separate registry-policy warning from the exploratory command is recorded above.
