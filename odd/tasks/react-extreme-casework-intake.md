# Add an extreme React casework intake scenario

## Objective

Add one deliberately complex, production-shaped Colander scenario to `examples/react-app`: an eligibility casework intake that combines component expansion, nested scalar groups, conditional rules, chained calculations, stable custom validation codes, Draft/Complete behavior, and both HTTP and direct WebAssembly execution sources.

## Problem

The current React catalog covers individual capabilities, but it does not present one coherent scenario that exercises their interaction end to end. A single casework intake can prove that compilation, component references, dynamic state, calculated values, request shaping, response validation, field-path mapping, and source isolation compose correctly while remaining honest about the current core's array-answer limitation.

## Scope

- Add a shared scalar-only casework document set and paired `http`/`wasm` catalog entries.
- Exercise component-reference expansion into nested groups with globally unique IDs and codes.
- Exercise `visibleWhen`, `enabledWhen`, and `requiredWhen` across dependent fields.
- Exercise a deterministic multi-step calculation graph with read-only calculated fields.
- Exercise stable custom validation codes, field-level path resolution, and Draft versus Complete validation behavior.
- Add focused catalog/request assertions and real packed-core execution coverage.
- Document the scenario, its expected outcomes, and why repeaters/multi-select remain separate from successful final validation.

## Constraints

- This is an authored coverage scenario, not a claim of an exact upstream golden vector.
- Keep the validated casework form scalar-only: the current packed core rejects array-valued answer JSON during response validation.
- Do not change the core, transport packages, NestJS API, lockfiles, archives, generated files, or unrelated dirty worktree changes.
- Preserve the generic renderer and submit-deferred rule evaluation; do not add live network evaluation on every keystroke.
- All wire documents remain JSON strings and are forwarded without parse/stringify round trips.
- Calculated fields are read-only and depend only on declared fields.
- Technical artifacts and UI copy remain in English.
- Effective strict TDD is not configured; ordinary functional checks are required.
- No commit, push, pull request, or remote operation is authorized.

## Authorized scope

Only the React sample catalog, its focused tests, and the React README may change, plus this feature document. Existing unrelated worktree changes must remain untouched.

## Delivery forecast

- Estimated authored change: approximately 300–500 lines across the shared documents, tests, and documentation.
- Delivery strategy: `ask-on-risk`; no remote delivery action.
- Rollback boundary: revert the new React sample/test/README changes and this feature document.

## Work units

- [x] **T1 — Define the extreme scenario.** Add the shared casework documents, conditional/calculated rule graph, component reference, scalar prefilled answers, expected facts, and paired HTTP/WASM catalog entries. Route: sole direct writer; trigger: multiple non-trivial definitions and catalog changes.
- [x] **T2 — Prove the behavior.** Add catalog/request-shape assertions and real packed-core compile/evaluate/validate coverage for valid, invalid, Draft, and Complete paths, including stable error codes and no-HTTP behavior for the WASM entry. Route: sole direct writer; trigger: multiple test surfaces and cross-layer behavior.
- [ ] **T3 — Document and verify.** Update the React README with the scenario, boundary, expected results, and commands; run focused tests, SSR, lint, and production build. Route: parent verification plus bounded command workers as needed.

## Acceptance criteria

- The selector exposes clearly labeled HTTP and direct-WASM variants of the same extreme casework scenario.
- The compiled form expands a component reference and renders nested scalar groups without duplicate IDs/codes.
- Evaluation demonstrates visible, enabled, required, and calculated state with deterministic values.
- A valid Complete submission succeeds through the selected transport; deliberate mutations produce the documented stable validation codes.
- Draft and Complete behavior differ where the sample declares Complete-only requirements.
- The WASM variant makes no `/api/forms/*` request and still exercises the real packed core.
- The sample does not claim successful array-bearing final validation; the existing repeater/multi-select limitation remains documented.
- `pnpm --dir examples/react-app test`, `test:ssr`, `lint`, and `build` results are recorded honestly.
- No commit, push, pull request, or remote operation is performed.

## Progress

- Feature document created before the first source write.
- Exploration route: delegated read-only mapper after CodeGraph status check.
- Implementation route: sole direct writer for the multi-file change; no further delegation.
- T1 and T2 are implemented in the React sample catalog and focused tests.
- Verification so far: `pnpm --dir examples/react-app test` passed (48 tests); `test:ssr` passed (1 test); focused TypeScript checks passed; lint reported only pre-existing warnings.
- Production build remains parent T3 verification so this writer does not regenerate generated artifacts.
- TDD mode: ordinary functional verification; strict-tdd evidence is not configured.
- Engram mirror: pending; Engram memory tools are not exposed in this runtime.

## Decisions

- Use an eligibility casework intake rather than an unbounded array/repeater form: it maximizes meaningful Colander interaction without pretending the current ABI can validate array answers.
- Keep the scenario data-driven so both transports share exactly the same model and expected facts.
