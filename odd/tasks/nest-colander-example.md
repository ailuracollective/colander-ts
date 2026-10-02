# Build a NestJS 12 example that consumes the package

## Objective

Add `examples/nest-app`: a NestJS 12 application inside this repository that consumes the packed
`@ailura/colander` archive as a real dependency and drives the WebAssembly form core through
Nest's dependency injection.

## Problem

The library is ESM-only (`"type": "module"`, a single `default` export condition) and is not
published to any registry. Older Nest versions scaffolded CommonJS applications, which cannot
`require()` an ESM-only package. Nest 12.0.5 scaffolds an ESM application instead (`"type":
"module"`, `module: "nodenext"`, top-level `await` in `main.ts`), so the interop problem is gone and
a plain static import is the supported path. The example must prove that path end to end — an ESM
Nest app resolving the packed archive and loading the WebAssembly core under Node — without
polluting the library's own workspace, lint, typecheck, and test configuration.

## Scope

- Scaffold a NestJS 12 application at `examples/nest-app` (Nest CLI 12.0.5, TypeScript, strict).
- Isolate the example from the root pnpm workspace with its own nested workspace root.
- Install `@ailura/colander` from the local `ailura-colander-0.1.0.tgz` archive.
- Add a Colander module with one async provider that loads the core once per process, a service
  that wraps it, and HTTP endpoints that exercise real public operations.
- Add unit and end-to-end tests that prove the WebAssembly artifact actually loads and computes.
- Add `examples/nest-app/README.md` documenting prerequisites, run, and test commands.
- Exclude `examples/**` from the root format and lint gates.

## Constraints

- The example is a consumer: it must import the public package name through the installed
  archive, never the repository source tree or a workspace link.
- Do not change library behavior, `src/`, the package export map, or root test configuration.
- Keep the example's install isolated: the root workspace must not gain a new member and the root
  lockfile must not change.
- `*.tgz` is gitignored, so the archive is a build prerequisite; the example README must say how
  to produce it.
- Every `…Json` field in the colander API is JSON **held as a string**. The example must not
  `JSON.stringify` documents on the way in; the content hash covers the bytes.
- Use English for technical artifacts, comments, and UI copy.

## Work units

- [x] **T1 — Scaffold the NestJS application.** Create `examples/nest-app` with the Nest CLI,
  skipping git initialization and installation. Route: parent, bounded command; trigger: single
  mechanical scaffold with no research or unresolved design work.
- [x] **T2 — Isolate the example workspace.** Add the nested workspace manifest and install the
  example's own dependencies so the root workspace and lockfile stay untouched. Route: delegated
  writer; trigger: installation output is broad and noisy, and the write follows research.
- [x] **T3 — Adopt the package artifact.** Install the local archive, and confirm it resolves as a
  real extracted package (not a link into the repository `dist/`) whose `wasm/` file is reachable
  from the compiled output. Route: delegated writer, same unit as T2.
- [x] **T4 — Implement the Colander integration.** Add the module, the async provider, the service,
  the DTOs, and the HTTP controller. Route: delegated writer; trigger: the implementation touches
  multiple non-trivial files with coordinated behavior.
- [x] **T5 — Prove it works.** Add unit and end-to-end coverage and record the observed results of
  build, tests, and a live endpoint call. Route: delegated writer for the focused runtime check;
  parent retains final structural readback.
- [x] **T6 — Keep the repository gates green.** Exclude `examples/**` from the root format and lint
  configuration, then re-run the root checks. Route: parent; trigger: two small mechanical edits in
  one already-understood config file.

## Acceptance criteria

- `examples/nest-app` builds with `pnpm build` and runs with `pnpm start`.
- `pnpm test` and `pnpm test:e2e` pass inside the example.
- A live request to the running application returns a value computed by the WebAssembly core
  (a content hash and the module identity), not a mocked one.
- The example imports `@ailura/colander` and resolves it from
  `node_modules/@ailura/colander` with the archive's `dist/` and `wasm/` layout.
- `git status` at the repository root shows no change to `package.json`, `pnpm-lock.yaml`, or
  `pnpm-workspace.yaml`.
- `pnpm exec vp check` and `pnpm test` at the repository root still pass.

## TDD and checks

- Effective TDD mode: not configured for this repository; ordinary functional checks are required.
- Prerequisite: `pnpm exec vp pack && pnpm pack` at the root when the archive is missing.
- Example checks: `pnpm --dir examples/nest-app build`, `pnpm --dir examples/nest-app test`,
  `pnpm --dir examples/nest-app test:e2e`.
- Runtime check: start the example and call its compile endpoint with `curl`, then read the
  response body.
- Structural checks: inspect `examples/nest-app/tsconfig.json`, the declared dependency, the
  resolved package directory, the compiled `dist/main.js` import form, and the root diff/status.
- Root regression checks: `pnpm exec vp check` and `pnpm test`.
- If the archive cannot be installed, report the exact failure instead of fabricating a runtime
  result.

## Work-unit and delivery forecast

- Estimated authored change: about 300 lines excluding CLI-generated scaffolding and lockfiles.
- Delivery strategy: `ask-on-risk` (default). No chain strategy is needed at this size.
- Rollback boundary: remove `examples/` and the two ignore-pattern entries; no library behavior is
  affected.
- Commit evidence: pending; the work runs on branch `feat/nest-colander-example` and the user did
  not request a commit.
- Candidate review: native assessment classified this candidate high risk (28 files, 4769 changed
  lines, evidence: code that starts other processes in `vite.config.ts`). The human declined the
  candidate-scoped review, so no review record was created and no lineage was opened; receipt-driven
  development stays enabled globally for later candidates.
- Engram mirror: pending; Engram tools are not exposed in this runtime.

## Progress

Feature document created before the first source write. Implementation and verification evidence is
added after each work unit.

- T1 implemented and checked: Nest CLI 12.0.5 scaffolded `examples/nest-app` with `--skip-git
  --skip-install --no-observe --strict`. Readback of the generated project corrected the plan's
  premise: Nest 12 scaffolds an **ESM** application (`"type": "module"`, `module: "nodenext"`,
  top-level `await` in `main.ts`, vitest 4 for tests, oxlint for lint), so no CommonJS interop shim
  is needed for the ESM-only package. The Problem section above was corrected accordingly.
- T2 implemented and checked: a nested `examples/nest-app/pnpm-workspace.yaml` (`packages: ["."]`)
  makes the example its own workspace root. Evidence: `pnpm -C examples/nest-app root` resolves to
  the example's `node_modules`, the install produced a nested `pnpm-lock.yaml`, and the root
  `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` are byte-identical (`git diff --stat`
  empty).
- T3 implemented and checked: the archive resolved as `file:../../ailura-colander-0.1.0.tgz`.
  `node_modules/@ailura/colander` is a pnpm store symlink whose target is a real extraction
  containing `dist/` and `wasm/colander.wasm`, not a link into the repository source. The installed
  `wasm/colander.wasm` sha256 matches the file inside the archive. A first live load from the example
  directory returned `{"name":"colander","version":"0.1.0","abi":1}` and `nextVersion` `1.0.1`.
- T4 implemented and checked: `ColanderModule` (async provider on a symbol token, static ESM import,
  `APP_FILTER` registration), `ColanderFilter` (validation → 400, `invalid_request`/`panic` → 500),
  `ColanderService`, `FormsModule`/`FormsService`/`FormsController`, and the JSON-text request
  boundary. The scaffold's hello-world controller and service were removed.
- T5 implemented and checked. Fixtures were extracted from the crate's golden vectors
  (`tests/golden/vectors/rules.json`, fixtures `fixture:evaluate-calculation.json` and
  `fixture:evaluate-bp-validation.json`) and re-verified against the installed package before any
  assertion was written. Observed: unit `7 passed`, e2e `5 passed`, `pnpm build` exit 0, and a live
  `node dist/main.js` whose boot log printed the core identity and whose `curl` calls returned the
  golden content hash `1e75829291a1604e424af6e917ae40c87643ba6162bc6d2ad5f62585983f038b`, the
  BMI calculation `22.86` keyed by field code with `enabled["bmi"] === false` keyed by field id, and
  a 400 carrying `kind: "validation"` for an unparseable document. The parent re-ran the unit and e2e
  suites independently and observed the same counts.
- T6 implemented and checked: `examples/**` added to `fmt.ignorePatterns` and `lint.ignorePatterns`
  in the root `vite.config.ts` (nested configs do not apply in Vite+ mode, so the library would
  otherwise lint the example with its restriction-level rules). Root `pnpm exec vp check` reports
  all 13 files formatted and no lint or type errors; root `pnpm test` reports 17 passed.
- Deviation on the record: the brief given to the writer stated a form-only
  `dependencyMetadataJson` value for a compile request that also carried rules; the real core adds
  rule metadata. The stated content hash matched exactly, no assertion depended on that field, and
  the writer reported the discrepancy instead of adjusting an expectation.
- Unverified by the parent: none outstanding. The live server run was performed by the delegated
  writer; the parent re-ran the automated suites.
