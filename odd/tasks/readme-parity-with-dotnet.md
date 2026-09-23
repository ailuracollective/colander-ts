# Align the TypeScript README with the .NET binding README

## Objective

Bring `README.md` up to the same structural and editorial quality as the sibling
`colander-dotnet/README.md`, while keeping every statement true for a
WebAssembly binding. The goal is parity of **coverage and clarity**, not a copy:
.NET-specific infrastructure (P/Invoke, `ArrayPool`, `SafeHandle`, NuGet,
`COLANDER_CORE`, native library resolution, the cynara benchmark) has no
TypeScript equivalent and must not appear.

## Problem

Both packages are boundaries over the same published Rust core (`colander` 0.1.0,
ABI v1). The .NET README documents the shared conventions and each operation in
detail; the TypeScript README is accurate but thin:

- No table of contents.
- `compile` never mentions `components` or `component-ref` expansion, so the
  "there is no component repository" contract is invisible.
- `evaluateRules` keying is described as "two maps" and omits that the **input**
  `values` map is keyed by field **code** — the precise thing the .NET README
  tabulates and the single easiest map to get wrong.
- `validateSchema` does not document `kind`, `schemas`, `label`, or that
  `kind: "form"` is where the `RULE_*` codes surface.
- `nextVersion` omits the deliberately-permissive parser examples.
- `validateResponse` does not explain `mode`, or that `normalizedAnswersJson`
  converts accepted values to their declared types, or the `path` exceptions.
- The ABI surface (eleven symbols; which three the binding uses internally) is
  not stated.

## Reference

`colander-dotnet/README.md` — read-only reference. Its section flow is the model:
intro, contents, install, loading, per-operation sections, "conventions that are
easy to get wrong", failures, threading/lifetime, tests. Its wording is **not**
copied verbatim; `.NET` facts are replaced with the WebAssembly reality.

## Scope

In scope: `README.md`, this document.

Out of scope by decision:

- `src/`, `test/`, `scripts/`, `package.json`, toolchain — no behavior change.
- The .NET README, including its claim that the TypeScript binding shares the
  `COLANDER_CORE` contract. That variable is not read anywhere in this
  repository (`load()` accepts bytes or a `WebAssembly.Module` only). The
  discrepancy is reported, not silently fixed here.

## Constraints

- Every sentence must be verifiable against `src/`, `test/`, `scripts/` or
  `package.json`.
- No `.NET`-only content; no `COLANDER_CORE` support claim.
- English, matching the existing README and the sibling reference.
- Preserve the artifact facts already proven by the rename and tar tasks: crate
  archive SHA-256 `315c951f0b0e865a00b5a3eaa5e5caf1a5a4fdf41de387d8253cb3d3df9ab2ea`,
  built artifact 1,494,683 bytes / SHA-256
  `f82c4d7bc749be8e584bd98540557937f2770b9cf780921334808825effb5d7c`.

## Work units

- [x] **T1 — Rewrite `README.md`.** Add the contents list, the per-operation
  sections, the full id/code keying table, the schema-check detail, and the ABI
  surface note; keep install, toolchain, build, tests and packaging sections
  accurate. Route: direct inline — a single substantial file, already fully
  understood from the mapping read; the writer threshold (2+ non-trivial files)
  is not met. Trigger honored: the 4-file mapping trigger fired, and the parent
  performed that mapping inline because the sibling reference is outside the
  delegated read boundary, so a worker could not have read it.
- [x] **T2 — Verify against source.** Re-read every documented field, key set and
  command against `src/types.ts`, `src/index.ts`, `src/errors.ts`,
  `src/wasm.ts`, `package.json` and the recorded build facts.
- [x] **T3 — Verify against the core's canonical docs.** Check the rewritten
  claims against `ailuracollective/colander` `docs/` (`entry-points.md`,
  `abi.md`, `rules.md`, `gotchas.md`). This caught a real error inherited from
  the .NET reference: the `validateSchema` example used `schemas: { form: … }`,
  but the core names each entry after the document it validates
  (`formSchema`, `uiSchema`, `rulesSchema`, `workflowSchema`). Corrected, and the
  entry names are now stated explicitly.

## TDD and checks

- Effective TDD mode: not configured for this project; ordinary checks apply.
- No test runner is meaningful for prose. The check is a source-by-source
  readback of the rewritten claims: request/result field names, the id-vs-code
  keying, the three error kinds, the eleven ABI exports, the command list, and
  the two SHA-256 values.
- Markdown **is** in the Oxfmt scope (`ignorePatterns` excludes only `dist/**`,
  `odd/**`, the lockfile and `*.wasm`), so `README.md` was normalized before
  verification: `pnpm exec vp fmt` formatted exactly one file (`README.md`) and
  `pnpm exec vp fmt --check` then reported "All matched files use the correct
  format." Oxlint does not lint markdown, so `vp check`'s lint half is
  unaffected; `vp test`/`vp typecheck` are untouched by a docs-only change.

## Progress and evidence

- Mapping: read `README.md`, `src/index.ts`, `src/types.ts`, `src/errors.ts`,
  `src/wasm.ts`, `package.json`, `vite.config.ts`, `test/binding.test.ts` count,
  `test/vectors.test.ts`, and the sibling `colander-dotnet/README.md` plus both
  projects' `odd/tasks/` documents.
- T1 done: `README.md` rewritten with a contents list, `The six operations`
  (compile / evaluateRules / validateResponse / validateSchema / contentHash /
  nextVersion) plus `The rest of the ABI`, a three-row keying table that includes
  the input `values` map, a `Failures` section with the three `kind` values and
  trap retirement, and the existing install/toolchain/loading/build/tests
  content preserved.
- T2 done: field names checked against `types.ts`; the keying table checked
  against `EvaluateRulesRequest`/`RuleEvaluation`; error kinds checked against
  `errors.ts`; the eleven exports checked against `REQUIRED_EXPORTS` in
  `wasm.ts`; commands checked against `package.json`; test counts 17 across
  `binding.test.ts` (11) and `vectors.test.ts` (6); artifact hash read from the
  on-disk `wasm/colander.wasm`.
- Route declaration: direct inline per work unit; no writer delegation was
  warranted for one file, and no subagent transport was exercised.
- T3 done: verified against the core docs. Confirmed correct in the README: the
  eleven exported symbols; the three envelope kinds; the id/code keying; the
  `RULE_*` codes being reachable only from `validate_schema` with `kind:"form"`;
  `validate_schema` never returning `{"valid":false}`; the whitespace-versus-key-
  order hashing rule; the permissive version parser. Corrected: the `schemas`
  entry names. Added: the `"1.0.0"` answer when nothing is published.
- `pnpm exec vp fmt --check` re-run after the corrections.

## Open items

- The .NET README states the TypeScript binding shares the `COLANDER_CORE`
  contract. This binding has no such variable. Either that sentence is wrong or
  this binding is missing a native-loading path; the user decides.
- The .NET README's `validateSchema` example uses `Schemas = ["form"] = …`,
  which contradicts the core's `formSchema` entry name. Same bug this document
  inherited and fixed here; the sibling still carries it.
- The core's own `docs/README.md` and `docs/entry-points.md` say the library
  exports **twelve** symbols (and that the header declares nine of twelve),
  while `docs/abi.md` and the actual export list say **eleven** — the mismatch
  left over when `last_panic` was removed. Both bindings document eleven
  correctly; the core docs are the ones that are stale.
- Commit and Engram evidence remain pending. The repository is unborn with every
  file untracked, so a work-unit commit would snapshot unrelated content; commit
  stays the user's call. Engram tools are not exposed in this runtime, so this
  document has no mirror.
