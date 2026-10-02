# Add the independent Colander transport package

## Objective

Create one independent headless package at `examples/colander-transport` named
`@ailura/colander-transport`. It contains the source-agnostic `ColanderTransport`
port, event contracts, and reusable form-model utilities currently living in
the React example. It does not know about HTTP, `fetch`, endpoint paths, React,
TanStack Form, or deployment details.

## Problem

The React example previously called source-specific functions from
`src/lib/api.ts`. That coupled presentation code to the delivery mechanism and
the current service deployment. The client should depend on a stable Colander
operation boundary that can later be backed by an in-process/WASM core, an
event source, or another command source.

## Why

Communication with Colander may come from the same client, an API, an event,
or a webhook. Request/response operations and event delivery have different
semantics, so they must not be forced into one misleading interface. This
package establishes the boundary without assuming one transport.

## Scope

- Add `examples/colander-transport` as its own pnpm workspace and package.
- Export typed `ColanderTransport` operations for core identity, compile,
  content hash, rule evaluation, response validation, schema validation, and
  next version.
- Export a separate `ColanderEventSource` and `ColanderEvent` contract for
  future event/webhook sources; do not implement an event adapter yet.
- Keep delivery mechanics, response parsing, and delivery-specific failure
  mapping outside this package.
- Move the reusable form-definition/index, pointer resolution, answer coercion,
  and rule-state helpers into the package so every frontend can use them.
- Export the form model types (`FormDefinition`, `FormNode`, `RuleState`, and
  related types) alongside the transport contracts.
- Keep the package free of React, TanStack Form, fetch, HTTP, Nest, and WASM.
- Add source-free contract and form-model tests; concrete source adapters test
  their own responsibilities.
- Connect `examples/react-app` to the local package, with its source-specific
  adapter implementing `ColanderTransport`.
- Keep the NestJS API and Colander wire contract unchanged.
- Make the form API object-first: `createFormDefinition` accepts parsed form/rules/UI objects, while a separate boundary helper decodes a compiled wire result exactly once.
- Hide validation answer serialization behind a package helper so React does not call `JSON.stringify` for form operations.

## Constraints

- Technical artifacts, comments, and UI copy remain in English.
- Every `...Json` field remains JSON text and is forwarded verbatim at the wire boundary.
- The public form-model API is object-first; JSON parsing/serialization belongs only to explicit boundary helpers.
- Package source does not import or reference `fetch`, delivery URLs, endpoint
  paths, delivery status codes, or response parsing.
- This object-first change adds no direct Colander/WASM dependency to the
  transport package; any existing React source-selection adapter remains
  consumer-owned and outside this package.
- Event/webhook contracts are separate from request/response commands.
- The package is independent with its own `pnpm-workspace.yaml`, package
  manifest, lockfile, tsconfig, and tests.
- The root workspace files, root lockfile, and NestJS public routes remain
  unchanged.
- Effective TDD mode is not configured; ordinary functional checks are used.
- Strong typing is a public contract: enable strictness and meaningful generic
  inference without leaking implementation details.
- Type tests must compile through the package's `typecheck` script.
- Context7 is unavailable in this runtime; do not claim it as a source.
- The ~400 authored-line heuristic is advisory only; the package remains
  coherent rather than cosmetically compressed.

## Work units

- [x] **T1 — Scaffold the independent package.** Added package metadata,
  workspace, TypeScript configuration, source layout, README, and dependency
  lockfile.
- [x] **T2 — Define the source-agnostic port and form model.** Added typed operations, neutral error/event types, compiled-form definition/indexing, pointer resolution, answer coercion, and pure rule-state helpers without React, TanStack Form, fetch, or delivery concerns.
- [x] **T3 — Move the React helpers into the package.** Moved the form-definition, schema types, rule-state helpers, and their tests into the package; deleted the duplicated React-local modules and tests; updated React consumers to import the package API while preserving TanStack Form, rule debounce, calculated values, hidden answers, Draft/Complete validation, `noValidate`, and UI error mapping.
- [x] **T4 — Verify.** Re-ran package, React, Nest, formatting, type, lint, structural boundary checks, and the live proxy round trip after moving the helpers.
- [x] **T5 — Make the form API object-first.** Change `createFormDefinition` to accept parsed document objects, add a compiled-wire decoder that parses exactly once, and add a request builder that hides answer serialization.
- [x] **T6 — Strengthen public types and inference.** Enable stricter compiler options, improve event and rule-state generics, add compile-time type tests, and keep declarations ergonomic for consumers.
- [x] **T7 — Verify modernization.** Re-run package, React, Nest, formatting, type, lint, structural boundary checks, and the live proxy round trip after the object-first/type changes.

## Acceptance criteria

- `examples/colander-transport` is independently installable and buildable with
  its own lockfile.
- `@ailura/colander-transport` exports `ColanderTransport`,
  `ColanderEventSource`, event and error types, the wire request/result types,
  and reusable form-model helpers/types without a source implementation.
- React owns its source-specific adapter and presentation components do not
  know delivery mechanics.
- React retains compilation, BMI evaluation, calculated values, hidden values,
  and Complete-mode response validation behavior.
- Package, React, and Nest tests/builds pass.
- Root workspace files and root lockfile remain unchanged.
- The package runs with strict compiler checks, and its public type tests compile successfully.
- `createFormDefinition` is object-first; React does not parse or stringify form documents directly.

## Authorized scope

The user explicitly authorized an independent package named
`@ailura/colander-transport`, temporarily located under `examples`. The
implementation may create that source-agnostic package and connect the React
example through its own adapter; it may not change the root workspace or Nest
API contract.

## Port and adapter decision

The package owns the source-agnostic port, neutral error/event types, and the
reusable form-model helpers. The React example owns TanStack Form, the native
renderer, and its source-specific adapters; it translates delivery failures into
its source-specific UI error. In-process/WASM and event/webhook adapters remain
outside this package, and any existing React adapter is consumer-owned.

## Object-first form boundary

`ColanderTransport` remains a wire-typed port: compiled form, UI, and rules
fields plus `answersJson` stay JSON text. The public form model is object-first,
so `createFormDefinition` accepts parsed `FormSchema`, `RulesSchema`, and
`UiSchema` objects. `createFormDefinitionFromCompiled` is the explicit decoder
for a compiled result and parses each present document once. The compile,
rule-evaluation, and response-validation request helpers own boundary
serialization; in particular, response validation owns answer coercion and
`answersJson` serialization. React holds the raw `CompiledForm` only to pass it
to these helpers and does not parse or stringify form documents or answers for
transport operations.

## Delivery forecast and constraints

- Estimated authored change: approximately 350–600 lines including tests and
  package documentation.
- Delivery strategy: `ask-on-risk`; no PR or push is authorized.
- Work-unit commits: not created because the user did not request a commit.
- Engram mirror: pending; memory tools are not exposed in this runtime.
- Rollback boundary: remove `examples/colander-transport` and restore the React
  example's previous API adapter and package metadata.

## Progress

- Repaired the zero-filled package source, test, and README files.
- Added the complete wire contract for all requested operations, including
  schema validation, plus neutral error and event-source types.
- Moved the React form-definition parser/indexer, pointer resolution, answer
  coercion, schema types, rule-state helpers, and their tests into
  `examples/colander-transport`.
- Deleted the duplicated React-local `form-definition.ts`, `apply-rules.ts`,
  `colander-types.ts`, and the two duplicated helper test files.
- Updated React consumers to import the package API directly. TanStack Form,
  native rendering, debounce, calculated-value merging, hidden-answer
  retention, `noValidate`, and final Colander validation remain unchanged.
- Kept delivery mechanics in
  `examples/react-app/src/lib/http-colander-transport.ts`; `src/lib/api.ts`
  remains a thin wrapper and no other React module owns delivery details.
- Updated both READMEs and the feature document to describe the single
  headless package boundary.
- Made `createFormDefinition` object-first and added
  `createFormDefinitionFromCompiled`, `createCompileRequest`,
  `createEvaluateRulesRequest`, and `createValidateResponseRequest` as explicit
  wire-boundary helpers.
- Moved sample document and answer serialization out of React; compiled
  documents remain forwarded verbatim and decoded exactly once for the form
  definition.
- Tightened strict test declarations, event/rule variance, and the
  `FormDefinition`-derived `RuleIndex` contract without introducing `any`.
- No commit or push was performed. The parent started the existing local Nest/React examples for the live proxy verification.
- The parent started the existing local Nest/React examples for the live proxy verification after the writer's no-server pass.

## Verification evidence

- `pnpm --dir examples/colander-transport install --lockfile-only` — passed;
  lockfile is up to date.
- `pnpm --dir examples/colander-transport install --frozen-lockfile` — passed;
  lockfile is up to date.
- `pnpm --dir examples/colander-transport typecheck` — passed.
- `pnpm --dir examples/colander-transport test` — passed; 3 test files, 27
  tests.
- `pnpm --dir examples/colander-transport build` — passed.
- `pnpm --dir examples/colander-transport lint` — passed with exit 0 and no
  warnings.
- `pnpm --dir examples/react-app install --lockfile-only` — passed; only the
  package and React example lockfiles were used.
- `pnpm --dir examples/react-app install --frozen-lockfile` — passed.
- `pnpm --dir examples/react-app test` — passed; 1 test file, 3 tests.
- `pnpm --dir examples/react-app build` — passed; TypeScript and Vite build
  completed.
- `pnpm --dir examples/react-app lint` — passed with exit 0; six existing
  non-fatal Fast Refresh/effect warnings remain.
- `pnpm --dir examples/nest-app test` — passed; 1 test file, 7 tests.
- `pnpm exec vp check` — passed; 13 files formatted and 8 files without
  warnings, lint errors, or type errors.
- Structural search of package `src` and `test` found no fetch, HTTP, URL,
  endpoint, status-mapping, or source-specific delivery implementation. The
  React source-specific mechanics are confined to
  `src/lib/http-colander-transport.ts`.
- CodeGraph status — index is up to date after the move.
- Live Vite proxy check — `/api/forms/core` returned Colander ABI 1 / version 0.1.0.
- Live proxy-mediated BMI evaluation returned `22.86`; Complete-mode blood-pressure validation returned `BP_SYSTOLIC_GT_DIASTOLIC`.

### Modernization pass verification (2026-09-24)

- `pnpm --dir examples/colander-transport typecheck` — passed.
- `pnpm --dir examples/colander-transport test` — passed; 4 test files, 37
  tests.
- `pnpm --dir examples/colander-transport build` — passed.
- `pnpm --dir examples/colander-transport lint` — passed with exit 0.
- `pnpm --dir examples/react-app test` — passed; 4 test files, 16 tests.
- `pnpm --dir examples/react-app build` — passed; TypeScript and Vite completed.
  The existing direct-source integration emitted a non-fatal browser
  externalization notice for `node:fs/promises`.
- `pnpm --dir examples/react-app lint` — passed with exit 0; six existing
  non-fatal Fast Refresh/effect warnings remain.
- `pnpm --dir examples/nest-app test` — passed; 1 test file, 7 tests.
- `pnpm exec vp check` — passed; 13 files formatted and 8 files without
  warnings, lint errors, or type errors.
- Structural search of package `src` found no `fetch`, HTTP, URL, endpoint, or
  status implementation, and no React, TanStack, Nest, or WebAssembly import.
- Impeccable detector over the changed React entry and form runner — passed
  with no findings.
- Existing React source-selection and direct-core fixture changes were preserved;
  they remain outside `@ailura/colander-transport`.
- No server was started by the writer; the parent then restarted the local React process and verified the live proxy round trip after modernization.

## Next steps

- Review the uncommitted package and React adapter changes when a commit or PR
  is explicitly authorized.
- Keep future in-process/WASM and event/webhook adapters source-agnostic and
  outside the package until their semantics are defined.
- Historical runtime verification through the Vite proxy is recorded above; a
  visual browser driver is not available to inspect the rendered controls
  interactively.
- Keep the work uncommitted until a commit or PR is explicitly requested.
