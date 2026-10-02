# Use TanStack Form in the React Colander runner

## Objective

Adopt TanStack Form (`@tanstack/react-form`) in `examples/react-app` as the state and submission owner for answer values. Keep Colander as the authority for compilation, rule evaluation, calculated values, and response validation; do not reintroduce SurveyJS or add a second validation engine.

## Problem

The native React runner currently owns answers with `useState`, refs, manual debounce scheduling, and a manual submit handler. TanStack Form can own the answer state and submit lifecycle while preserving Colander's code-keyed answer contract and asynchronous rule round trip.

## Why

The user explicitly asked to use TanStack Forms. This should be a real integration rather than a cosmetic dependency: the form instance must drive values, updates, and submission, while Colander remains responsible for domain behavior.

## Scope

- Add `@tanstack/react-form` to the React example and regenerate only its lockfile.
- Refactor `FormRunner` to use `useForm` with a single `answers` object so field codes containing dots remain literal keys.
- Route native field updates and repeater row updates through the TanStack form instance.
- Keep debounced Colander evaluation, stale-response protection, calculated-value merging, hidden values, read-only behavior, Draft/Complete validation, and pointer-to-field error mapping.
- Add focused tests for the TanStack-compatible state boundary or update existing helper tests where appropriate.
- Update the React README to document TanStack Form and its boundary with Colander.
- Do not change the root workspace, NestJS API, or Colander wire contract.

## Constraints

- Technical artifacts and UI copy remain in English.
- Answer keys are field codes and must remain flat inside the form's `answers` object; never let dot-containing codes become TanStack dot paths.
- Rules boolean maps remain keyed by field IDs; calculated values remain keyed by codes.
- Compiled JSON strings are forwarded verbatim to the API.
- Hidden answers are retained; calculated and statically read-only fields remain non-editable.
- Colander response validation remains final; browser-native validation must not preempt it.
- The ~400 authored-line heuristic is advisory only; keep this a coherent integration and avoid cosmetic compression.
- Effective TDD mode is not configured in this repository; ordinary functional checks are required.

## Work units

- [x] **T1 — Add TanStack Form and establish the answer boundary.** Installed `@tanstack/react-form`, defined the form value shape with a flat `answers` record, and added focused TanStack Form boundary tests.
- [x] **T2 — Refactor FormRunner around `useForm`.** Moved native and repeater edits, calculated-value merges, and submission through the TanStack Form instance while retaining Colander debounce, stale-response protection, and rule state.
- [x] **T3 — Document and verify.** Updated the React README and completed the repository checks below. A live Nest/React round trip remains deferred because starting servers was explicitly out of scope.

## Acceptance criteria

- The React example depends on `@tanstack/react-form` and no longer uses SurveyJS.
- Field codes such as `body.weight.kg` remain literal keys in the submitted answer object.
- The runner uses TanStack Form state for user edits, repeater rows, and submit lifecycle.
- Colander still evaluates rules, computes BMI, and returns validation errors through the existing API.
- `pnpm --dir examples/react-app test`, `build`, and `lint` pass.
- Root workspace and NestJS public contracts remain unchanged.

## Authorized scope

The user explicitly authorized using TanStack Forms in the React example. The implementation may change the React example's form state integration, package metadata/lockfile, focused tests, and README only.

## Delivery forecast and constraints

- Estimated authored change: approximately 150–300 lines, mostly a focused state integration and tests.
- Delivery strategy: `ask-on-risk`; no PR or push is authorized.
- Work-unit commits: not created because the user did not request a commit.
- Engram mirror: pending; memory tools are not exposed in this runtime.
- Rollback boundary: revert the TanStack integration and remove only its package/lock changes.

## Progress

- Feature document created before the first source write.
- Existing native React runner and Colander boundary were inspected; `form-definition.ts` and `apply-rules.ts` remain unchanged.
- `examples/react-app/package.json` now depends on `@tanstack/react-form` `^1.33.5`; only the React example lockfile was regenerated.
- `FormRunner` now uses `useForm` with `{ answers: Record<string, unknown> }`; dotted field codes remain literal keys inside `answers`.
- Native controls, repeater row edits, calculated-value merges, and submit lifecycle read/write through the TanStack Form API. Colander evaluation, stale-response invalidation, hidden-value retention, and response validation remain in the existing boundary.
- Added `src/lib/form-values.test.ts` for dotted-key, repeater-row, and submit-value behavior.
- README documents TanStack Form as the React answer/submit layer and Colander as the rules/validation layer.
- No commit, push, or server start was performed.

## Verification evidence

- `pnpm --dir examples/react-app install --lockfile-only` — passed; lockfile already up to date.
- `pnpm --dir examples/react-app install --frozen-lockfile` — passed; lockfile is up to date.
- `pnpm --dir examples/react-app test` — passed; 3 test files, 25 tests.
- `pnpm --dir examples/react-app build` — passed; TypeScript and Vite production build completed.
- `pnpm --dir examples/react-app lint` — passed (exit 0); six existing non-fatal Fast Refresh/effect warnings, no lint errors.
- Structural search for `SurveyJS|survey-core|survey-react-ui|to-survey|surveyJson` in the React example — no matches. `rg` was unavailable, so the dedicated Grep checks were used.
- `pnpm --dir examples/nest-app test` — passed; 1 test file, 7 tests.
- `pnpm exec vp check` — passed; 13 files formatted and 8 files without warnings, lint errors, or type errors.
- CodeGraph status — index up to date after the edits.
- Live Vite proxy check — `/api/forms/core` returned Colander ABI 1 / version 0.1.0.
- Live proxy-mediated BMI evaluation returned `22.86`; Complete-mode blood-pressure validation returned `BP_SYSTOLIC_GT_DIASTOLIC`.

## Next step

- Runtime verification through the Vite proxy is complete; a visual browser driver is not available to inspect the rendered controls interactively.
- Keep the work uncommitted until a commit or PR is explicitly requested.
