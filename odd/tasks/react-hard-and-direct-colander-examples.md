# Add hard Colander examples and a direct client transport

## Objective

Extend `examples/react-app` with authored examples that exercise Colander behavior beyond the two local golden fixtures, and add examples that call the packed Colander WebAssembly binding directly in the browser without using the NestJS HTTP API.

## Problem

The React example currently has only a calculation case and a cross-field validation case. It therefore leaves the renderer's most important paths unproven: dynamic visibility/enablement/required state, nested groups and repeaters, multi-select values, component expansion, UI hiding, and stable error codes for a deliberately invalid Complete submission. It also has no direct-client adapter, so every sample depends on the Nest service even though the public package supports `colander.load()` in browsers.

## Scope

- Add authored, golden-style hard cases with source documents, explicit expected results, and an execution source.
- Add a direct WebAssembly source through the reusable `@ailura/colander-web` package, which lazily loads and caches the packed `@ailura/colander` core.
- Select HTTP or direct WASM transport per sample and pass the selected port into compilation, rule evaluation, and response validation.
- Make status and inspector copy describe the selected execution source without inventing backend results.
- Add focused tests for the sample catalog, direct transport, source isolation, and stable validation codes.
- Add the packed package dependency, lockfile entry, and README instructions.

## Constraints

- This is a coverage-oriented example, not a claim that the authored cases are exact upstream golden vectors.
- The direct path means no calls to NestJS or `/api/forms/*`; `colander.load()` may still fetch the same-origin packaged `wasm/colander.wasm` asset in the browser.
- All `...Json` wire documents remain strings and are forwarded without a parse/stringify round trip.
- Answers remain keyed by field code; rule visibility/enabled/required maps remain keyed by field id.
- Groups keep children flat; repeaters use arrays of row objects keyed by child codes.
- The native form remains `noValidate`; Colander remains the validation authority.
- Technical artifacts and UI copy remain in English.
- Effective strict TDD is not configured; ordinary functional checks are required.
- The advisory authored-line heuristic is not a hard cap; preserve coherent tests and documentation.
- No commit, push, pull request, or remote operation is authorized.

## Authorized scope

The React example's samples, transport wiring, package metadata/lockfile, focused tests, and README may change. The root binding, transport package, NestJS API, and unrelated existing work must remain untouched.

## Delivery forecast

- Estimated authored change: approximately 450–700 lines across samples, adapter wiring, tests, and documentation.
- Delivery strategy: `ask-on-risk`; no remote delivery action.
- Rollback boundary: revert the React example source, package metadata/lockfile, tests, README, and this feature document.

## Work units

- [x] **T1 — Expand the sample catalog.** Added authored dynamic-rule, nested group/repeater plus multi-select, component-reference, direct BMI, and direct dynamic samples. Added stable expected facts and request-boundary tests; these are analogues, not exact upstream golden vectors. Route: delegated writer; trigger: multiple non-trivial sample definitions and tests.
- [x] **T2 — Add the direct WASM source.** Added the reusable `@ailura/colander-web` package over the packed main core, including shared loading, retry, panic recovery, typed errors, and operation forwarding. React now consumes that package instead of a local adapter. Route: delegated writer; trigger: package boundary plus focused tests.
- [x] **T3 — Inject the selected source.** App now composes HTTP or direct WASM per sample, passes the selected port into FormRunner, honors UI hidden-field metadata, and uses source-aware status/inspector/validation/offline copy. Route: delegated writer; trigger: coordinated integration files.
- [x] **T4 — Verify and document.** Added README prerequisites, source boundaries, sample coverage, and commands. Focused tests, production build, lint, package-asset checks, and the Impeccable detector were run; results are recorded below. Route: parent verification plus any bounded command worker.

## Acceptance criteria

- The sample selector includes hard HTTP-style cases and direct WASM cases with clear source labels.
- Dynamic state, calculations, nested/repeater values, multi-select, component expansion, and invalid Complete validation are demonstrable or covered by focused tests.
- Direct samples never invoke HTTP/Nest transport methods; only the same-origin WASM asset may be fetched by `colander.load()`.
- Direct transport loads once per successful core, retries a failed load, and preserves `ColanderError.kind` for validation failures.
- The React production build includes the packaged WASM asset and type-checks.
- `pnpm --dir examples/react-app test`, `build`, and `lint` results are recorded honestly.
- Engram mirror is marked pending because Engram tools are not exposed in this runtime.

## Progress

- Feature document created before the first source write.
- Exploration route: delegated read-only mapper after CodeGraph initialization.
- Implementation route: delegated direct writer for coordinated multi-file changes.
- TDD mode: ordinary functional verification; no strict TDD evidence configured.
- Engram mirror: pending; memory tools are not exposed in this runtime.

## Observed verification — 2026-09-24

- `pnpm --dir examples/colander-web typecheck`, `test`, `build`, and `lint` — passed; the new package has 7 focused tests and no duplicate runtime implementation.
- `pnpm --dir examples/react-app test` — passed: 4 test files, 11 tests. Coverage includes sample/source/request shape, injected source isolation, real direct-client BMI/dynamic behavior, calculated-answer filtering, and no HTTP fetch.
- `pnpm --dir examples/react-app build` — passed: TypeScript project build and Vite production build. Vite emitted `dist/assets/colander-8O7sceXn.wasm` (1,494.68 kB). The build reports the packed loader's expected browser externalization warning for its Node-only `node:fs/promises` branch.
- `pnpm --dir examples/react-app lint` — exited 0 with six existing React/effect warnings; no errors.
- `pnpm --dir examples/react-app install --frozen-lockfile` — passed; the React lockfile is reproducible from the local web package and main archive.
- `pnpm --dir examples/colander-transport typecheck && pnpm --dir examples/colander-transport test && pnpm --dir examples/colander-transport build` — passed: 38 transport tests and the transport build.
- `pnpm --dir examples/colander-web pack --dry-run` — passed; the tarball contains only `dist`, `package.json`, and `README.md`.
- `pnpm --dir examples/nest-app test && pnpm --dir examples/nest-app test:e2e` — passed: 7 unit tests and 5 e2e tests; the existing HTTP contract remains green.
- Native RDD candidate review was offered for the selected worktree and explicitly declined by the user. No review receipt or approval was created; ordinary functional checks remain the verification of record.
- Follow-up bugfix: the calculated-value filter lives in `examples/colander-transport/src/form-definition.ts`, inside `createValidateResponseRequest`, and the web package/React integration inherit that boundary.
- No commit, push, pull request, or remote operation was performed.

## Deviations and limitations

- The current packed `colander` 0.1.0 core evaluates the nested repeater/multi-select request, but `validateResponse` rejects array-valued answer JSON with `ColanderError.kind === 'validation'` and `Nested JSON arrays are not supported as answer values`. The access sample and README document this honestly; the focused test asserts request shape and rule evaluation rather than claiming a successful array-bearing response validation.
- Browser-only `colander.load()` asset fetching is not exercised by the Node Vitest environment. The web package tests and React production build prove the package/build boundary; the same-origin fetch caveat is documented for browser use.
- The authored hard samples are coverage-oriented analogues and are not described as exact upstream golden vectors.

