# Replace SurveyJS with a native React and Colander form runner

## Objective

Remove SurveyJS from `examples/react-app` and keep the example focused on React, the NestJS API adapter, and the Colander WebAssembly core. Render the compiled form with native React controls while preserving Colander rule evaluation, calculated values, draft/complete validation, and field-level error mapping.

## Problem

The current React example uses SurveyJS as both its form model and renderer. That adds a presentation dependency and makes the example less direct: the example should demonstrate the Colander contract rather than a second form engine. The replacement must retain the code-keyed answers, id-keyed rule maps, compiled JSON strings, hidden-value behavior, and static/dynamic read-only rules.

## Why

The user explicitly wants to work only with React and Colander. Keeping the NestJS HTTP boundary is the smallest safe architecture: the browser remains a presentation client and Colander remains the source of truth for form semantics.

## Scope

- Replace the SurveyJS translator/model with a pure compiled-form definition and index.
- Render supported field types recursively with native React controls.
- Apply visibility, enabled, required, and calculated values from `/forms/evaluate-rules`.
- Preserve `/forms/validate-response` as the final authority and map its JSON pointer errors to labels.
- Remove SurveyJS dependencies, imports, generated SurveyJS agent instructions, and stale SurveyJS wording.
- Update focused tests, package metadata/lockfile, and the React example README.
- Do not change the root library, NestJS API contract, or root workspace files.

## Constraints

- Technical artifacts and UI copy remain in English.
- Every wire document remains a JSON string and is forwarded verbatim to the API.
- Answer keys are field codes; rule boolean maps are field ids.
- Groups keep children flat; repeaters use row objects keyed by child codes.
- Hidden answers are retained.
- Calculated and statically read-only fields cannot be edited.
- The final validation verdict comes from Colander, not browser-native validation.
- Effective TDD mode is not configured in this repository; ordinary functional checks are required.
- The ~400 authored-line heuristic is advisory only; keep the change coherent and avoid cosmetic compression.

## Work units

- [x] **T1 — Replace the form definition and state helpers.** Port parsing, indexing, path resolution, answer coercion, and rule application into SurveyJS-free modules with focused unit tests. Route: delegated writer; trigger: multiple non-trivial modules and tests.
- [x] **T2 — Replace the React runner and app wiring.** Render native controls, retain debounced evaluation, calculated values, validation mode, and error panels. Route: same delegated writer; trigger: coordinated renderer and integration files.
- [x] **T3 — Remove SurveyJS and document the new boundary.** Update package/lock metadata, README, and stale generated SurveyJS files. Route: same delegated writer; trigger: dependency and documentation cleanup accompanies the implementation.
- [x] **T4 — Verify the replacement.** Run focused tests, build, lint, structural SurveyJS search, root checks, and a live Nest/React round trip if the local server is available. Route: parent verification plus one bounded runtime check.

## Acceptance criteria

- `pnpm --dir examples/react-app test` passes with no SurveyJS imports or test dependencies.
- `pnpm --dir examples/react-app build` and `pnpm --dir examples/react-app lint` pass.
- A BMI form filled through React reaches the backend and displays the backend-calculated BMI.
- A blood-pressure form rejected by Colander in Complete mode displays the corresponding field error.
- Dynamic visibility, enabled, required, calculated, and read-only behavior works with native controls.
- `rg` finds no runtime SurveyJS references in `examples/react-app` outside ignored/generated output.
- The root library and NestJS API contract remain unchanged.

## Authorized scope

The user explicitly authorized removing SurveyJS and continuing with React and Colander. The implementation may change only the React example's presentation/model layer, its tests, dependency metadata, documentation, and stale SurveyJS-generated instructions.

## Delivery forecast and constraints

- Estimated authored change: approximately 500–800 lines, mostly the replacement renderer and focused tests; this is one coherent behavior and is not split solely for the advisory line heuristic.
- Delivery strategy: `ask-on-risk`; no PR or push is authorized.
- Work-unit commits: not created because the user did not request a commit.
- Engram mirror: pending; memory tools are not exposed in this runtime.
- Rollback boundary: revert the React example changes and restore its previous SurveyJS files.

## Progress

- Feature document created before the first source write.
- Baseline: the React example currently has uncommitted changes from the prior SurveyJS feature; preserve unrelated root and NestJS changes.
- Route: delegated direct writer after read-only mapping.
- T1 implemented: `form-definition.ts` and pure `apply-rules.ts` now own the compiled index, pointer lookup, coercion, and effective state. Focused tests cover id/code maps, labels, nested groups/repeaters, calculated/static read-only fields, hidden values, coercion, and malformed percent escapes.
- T2 implemented: `form-runner.tsx` renders native inputs, selects, checkboxes, textareas, groups, and repeater rows. It keeps code-keyed answers, invalidates stale debounced evaluations, merges calculated values without scheduling a feedback request, uses `noValidate`, and renders response errors beside fields.
- T3 implemented: removed the two runtime dependencies, regenerated only `examples/react-app/pnpm-lock.yaml`, removed the stale generated agent metadata/skills, and rewrote the README around the React + Colander HTTP boundary.
- Evidence so far: `pnpm --dir examples/react-app install --lockfile-only` passed; `pnpm --dir examples/react-app install --frozen-lockfile` passed; focused tests passed 22/22; the production build passed; lint exited 0 with five existing shadcn/App warnings; `pnpm --dir examples/nest-app test` passed 7/7; root `pnpm exec vp check` passed. The exact requested `rg` command could not run because `rg` is not installed; the dedicated source/config search found no matches. Root `pnpm test` ran 17 tests with 13 passing and 4 pre-existing frozen-vector count failures in `test/vectors.test.ts` (expected/received 6/5, 59/61, 8/6, and 38/34). The live Nest/React round trip passed after implementation: Nest health and the Vite proxy `/api/forms/core` both returned Colander ABI 1 / version 0.1.0; a proxy-mediated BMI evaluation returned 22.86, and Complete-mode blood-pressure validation returned `BP_SYSTOLIC_GT_DIASTOLIC`.
- Next step: review the final diff; no live browser driver is available for visual interaction verification.
