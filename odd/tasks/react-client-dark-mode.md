# Add dark mode to the React client

## Objective

Add an accessible System / Light / Dark theme preference to `examples/react-app`, including system detection, persistence, SSR-safe initialization, tests, and concise usage documentation.

## Problem

The React client already defines light and dark shadcn tokens, but no runtime code applies the `.dark` class. The UI therefore stays light regardless of operating-system preference, and users have no way to select or retain a dark theme.

## Scope

- Add a browser-safe theme preference module with `system`, `light`, and `dark` states.
- Apply and persist the selected theme on the root document.
- Add a pre-hydration bootstrap so a stored or system dark theme does not flash light during startup.
- Add a labeled, responsive theme selector to the existing React header controls.
- Add focused tests for preference parsing, system resolution, storage failures, and root-class application.
- Extend the SSR safety test and React README.

## Constraints

- Limit product changes to `examples/react-app`; do not change the headless `@ailura/colander-client` package.
- Reuse the existing shadcn `Select`, semantic color tokens, and dark palette; add no dependency.
- Keep browser globals behind effects, event handlers, or the pre-hydration script; server rendering must remain browser-free.
- Treat unavailable, malformed, or inaccessible storage as `system` rather than failing the application.
- Preserve the current visual identity and unrelated work in the dirty worktree.
- Technical artifacts and UI copy remain in English.
- Effective strict TDD is not configured; ordinary functional checks are required.
- The approximately 400 authored-line heuristic is advisory, not a reason to omit coherent tests or documentation.
- No push, pull request, or remote operation is authorized.

## Authorized scope

The React example's theme module, root document, app header, CSS color-scheme declarations, focused tests, and README may change. Generated route files, package metadata, lockfiles, the public client package, and unrelated existing changes must remain untouched.

## Delivery forecast

- Estimated authored change: approximately 520–580 lines, primarily the browser-safe theme module and its focused Node tests. The coherent test coverage exceeds the advisory heuristic; do not code-golf it away.
- Delivery strategy: `ask-on-risk`; no remote delivery action.
- Rollback boundary: remove the theme module and selector, the root bootstrap/color-scheme additions, focused tests, README section, and this feature document.

## Work units

- [x] **T1 — Add the theme runtime and accessible selector.** Implemented System / Light / Dark behavior, safe persistence feedback, OS-change tracking, pre-hydration initialization, and a responsive accessible selector with focused tests. Route: delegated writer; trigger: coordinated changes across more than two non-trivial files and SSR-sensitive integration.
- [x] **T2 — Verify and document.** Focused and full tests, SSR rendering, TypeScript production build, lint, independent read-only verification, and the Impeccable detector passed within the documented limits. Route: parent verification plus one independent verifier.

## Acceptance criteria

- The theme defaults to the operating-system preference and responds to OS changes while set to System.
- Explicit Light and Dark selections override the OS and survive reloads when browser storage is writable; failed saves remain session-local and visible.
- Missing, malformed, or inaccessible storage safely falls back to System.
- The correct theme is applied before hydration without server-side browser-global access.
- Native form controls receive the matching `color-scheme` behavior.
- The theme selector has an accessible label and works in the existing responsive header.
- Focused tests cover theme state, storage edge cases, and DOM class application.
- React tests, production build, and lint results are recorded honestly.
- Engram mirror is marked pending because Engram tools are not exposed in this runtime.

## Progress

- Feature document created before the first source write.
- Exploration route: delegated read-only mapper after CodeGraph verification.
- Implementation route: delegated direct writer; one writer owns the coordinated React changes.
- TDD mode: ordinary functional verification; no strict TDD evidence is configured.
- Engram mirror: pending; memory tools are not exposed in this runtime.
- Work-unit commit: pending; this runtime requires an explicit user request before committing.

## Observed verification — 2026-09-24

- `pnpm --dir examples/react-app exec vitest run src/lib/theme.test.ts` — passed: 1 file, 14 tests. Coverage includes storage parsing/failures, bootstrap execution, system resolution, root-class updates, OS subscription, and legacy listener cleanup.
- `pnpm --dir examples/react-app test:ssr` — passed: 1 file, 1 test. The server document contains the fixed bootstrap before `</head>` without browser globals or WASM initialization.
- `pnpm --dir examples/react-app test` — passed: 7 files, 46 tests.
- `pnpm --dir examples/react-app build` — passed: TypeScript project build plus client and SSR Vite production builds. The existing packed-core browser externalization warning for `node:fs/promises` remains.
- `pnpm --dir examples/react-app lint` — exited 0 with 9 warnings and no errors. One warning is the intentional stored-preference synchronization at `src/App.tsx:83`; the other warnings are pre-existing or file-structure warnings.
- Impeccable detector over `src/App.tsx` and `src/index.css` — passed with no findings.
- Independent read-only verification — initial verdict `PASS WITH RISKS`; the writer then corrected persistence-write feedback, bootstrap execution coverage, legacy listener cleanup, and the pre-hydration selector placeholder. The focused correction checks passed.
- No browser screenshot pass was available in this runtime; SSR document ordering and the fixed bootstrap were verified structurally and by isolated VM execution.
- The attempted `oxfmt` check was unavailable because the React package does not expose an `oxfmt` binary; no source was formatted by that failed command.
- No commit, push, pull request, remote operation, or native review receipt was created.

## Deviations and limitations

- The source tree was already heavily dirty and `examples/react-app` is untracked as a whole. Git cannot produce an isolated dark-mode diff or commit boundary without absorbing unrelated user-owned work, so no work-unit commit was created.
- Native review assessment is high/unassessable because the current worktree combines this feature with the broader monorepo refactor. Selectorless STATUS then returned `collect` / `external.select_intended_untracked`, but the provider did not issue an executable capture invocation for this runtime. No selection was invented, native START was not invoked, and ordinary functional verification is the current verification of record.
- The Engram mirror remains pending because memory tools are not exposed in this runtime.
