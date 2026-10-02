# Engine origin selectable by environment

## Objective

Make the origin of the Colander WASM engine an explicit, environment-driven decision instead of a
hardcoded crates.io download. One spec variable selects `crate`, `github`, or a local `path`, and the
release flow can require an integrity digest. The ordinary offline packing path must stay offline.

## Problem

`packages/colander/scripts/build-wasm.mjs` hardcodes `colander@0.1.0` from crates.io with a pinned
archive SHA-256. There is no supported way to build the engine from a GitHub release, from a local
Rust checkout, or from an already-built local `.wasm` without editing the script. Rebuilding the
engine against a working branch means hand-patching a release script, which is unreviewable and
untested.

## Authorized scope

- `packages/colander/scripts/build-wasm.mjs` and new sibling script modules.
- `packages/colander/package.json` script wiring for the release-only digest requirement.
- Focused unit tests for spec parsing, resolution planning, and the offline `path` origin.
- `README.md` and `RELEASE.md` engine-origin documentation.
- Preservation of existing behavior, offline `pnpm run pack`, and unrelated uncommitted work.

## Design direction

- One spec variable: `COLANDER_WASM_SOURCE`, defaulting to `crate:colander@0.1.0`.
  - `crate:<name>@<version>` — download the `.crate` archive from crates.io, verify the pinned
    archive digest for the default pair, extract safely, compile with cargo.
  - `github:<owner>/<repo>@<ref>[!<asset>]` — download a prebuilt release asset
    (`https://github.com/<owner>/<repo>/releases/download/<ref>/<asset>`), default asset
    `colander.wasm`. No Rust toolchain, no source build.
  - `path:<target>` — a `.wasm` file is validated and copied; a directory containing `Cargo.toml` is
    compiled with cargo. No network access.
- One digest variable: `COLANDER_WASM_SHA256` (64 lowercase hex). Optional in ordinary runs,
  verified against the final engine artifact in every origin.
- A release-only script variant requires the digest. The default pinned crate keeps its in-code
  archive digest as the release integrity gate, so a release rebuild of `colander@0.1.0` does not
  require inventing a new pinned artifact digest.
- One module validation contract for every origin: `WebAssembly.validate`, no imports, all eleven
  required exports present, no `colander_last_panic` export.
- Every origin keeps the existing temporary-directory cleanup and the crate archive safety checks;
  those checks apply only to the tar-based crate origin.
- `COLANDER_WASM_OUTPUT` overrides the destination so the script is testable without touching the
  checked-in package input.

## Constraints

- Technical artifacts and documentation remain in English.
- Ordinary functional checks are required; strict TDD is not configured.
- No network access in tests, and no test may overwrite `packages/colander/wasm/colander.wasm`.
- Do not reset, clean, or revert unrelated user changes.
- Do not commit unless the user explicitly asks; record commit evidence as not applicable.
- `pnpm run pack` and `pnpm run bootstrap` must remain offline and unchanged in behavior.
- Reject malformed specs with actionable messages naming the accepted forms and the variable.

## Work units

- [x] **T1 — Engine origin resolution.** Extract pure spec parsing, plan resolution, digest
  handling, and download URLs into a dedicated script module with no filesystem or network IO;
  define one validation contract. Route: delegated writer; trigger: refactor of a release-critical
  script.
- [x] **T2 — Origin execution in `build:wasm`.** Wire the three origins into the existing build
  script: crate download/extract/compile, GitHub release asset download, and local `path` file or
  directory. Preserve archive safety, temp cleanup, output copy, and module verification.
  Route: same delegated writer.
- [x] **T3 — Release digest wiring.** Add the release-only digest-required script and route the root
  `release:pack` through it; keep the default pinned crate archive digest valid as the release gate.
  Route: same delegated writer.
- [x] **T4 — Focused tests.** Cover spec parsing for all three origins plus rejection cases, the
  release digest gate, and one end-to-end offline `path` copy into a temporary output using the
  checked-in artifact as fixture. Register the suite in `test:unit`. Route: same delegated writer.
- [x] **T5 — Documentation.** Document the spec grammar, all variables, the three origins, the
  integrity rules, and the release rebuild flow in `README.md` and `RELEASE.md`, including the
  troubleshooting row for an origin or digest failure. Route: same delegated writer.
- [ ] **T6 — Verification.** Run focused unit tests, typecheck, lint, check, fmt, and the offline
  pack path; record every result and environmental limitation. Route: fresh verification worker;
  parent retains structural readback.

## Acceptance criteria

- `COLANDER_WASM_SOURCE` selects crate, GitHub release asset, or local path with no script edits.
- An unset variable preserves today's exact pinned crates.io behavior.
- `github:` downloads a prebuilt asset and requires no Rust toolchain.
- `path:` accepts both a `.wasm` file and a crate directory, works offline, and never downloads.
- `COLANDER_WASM_SHA256` is verified when present in every origin; the release variant requires it
  except for the default pinned crate, whose archive digest is the gate.
- Every origin rejects a module that is invalid, imports anything, misses a required export, or
  exposes `colander_last_panic`.
- Malformed specs and digest values fail with actionable messages.
- `pnpm run pack`, `pnpm run test:unit`, and the offline consumer path are unchanged for a default
  environment; no test mutates the checked-in WASM input.

## Progress

- Feature document created before the first source write.
- Effective TDD mode: ordinary functional verification; strict TDD is not configured.
- Engram mirror: pending; mirror is created alongside this document.
- Route: one delegated writer for T1-T5, then an independent verification worker for T6.
- No commits are authorized by the current user request.

## Verification evidence

- T1 implementation: `packages/colander/scripts/wasm-engine-source.mjs` holds the grammar, the
  digest rules, the download URLs, the release gate, the export contract, and the plan label, with no
  filesystem or network IO. An absent optional value is modelled as an empty string because this
  workspace bans both `null` and `undefined` literals in source.
- T2 implementation: `scripts/build-wasm.mjs` keeps orchestration and IO. `crate` downloads and
  safely extracts, `github` downloads a prebuilt asset, and `path` reads a `.wasm` or compiles a
  crate directory. The archive-safety rules moved unchanged to `scripts/archive-safety.mjs`, and the
  artifact-name check no longer assumes the crate is named `colander`.
- T3 implementation: `packages/colander/package.json` adds `build:wasm:release`
  (`node scripts/build-wasm.mjs --require-digest`), and the root `release:pack` routes through it.
  No shell env-prefix syntax is used, so the scripts stay cross-platform.
- T4 implementation: `test/wasm-engine-source.test.ts` covers every origin, the asset override, the
  relative path, 14 rejected specs, digest normalization and rejection, the release gate per origin,
  and the export contract. `test/build-wasm.test.ts` runs the real script offline: a `path` copy that
  must stay byte-identical, a matching digest, a mismatched digest that must not write the output, a
  non-module file, four rejection cases, and both release-gate outcomes. Both suites are registered in
  `test:unit`.
- `pnpm --filter @ailura/colander run test:unit` passed: 4 files, 43 tests.
- `pnpm --filter @ailura/colander run check`, `run lint`, `run fmt:check`, and `run typecheck`
  all passed. Root `pnpm run check` and `pnpm run fmt:check` passed.
- `pnpm run test:contract` passed: 2 files, 14 tests. Root `pnpm run test:unit` passed across the
  three packages (43 + 44 + 10 tests).
- `pnpm run pack:offline` passed and produced all three versioned archives, so the offline packing
  path is unchanged.
- `packages/colander/wasm/colander.wasm` still hashes to
  `659ae04ac004546a82d14daf10364b7c14759aa7e5b4496bf9f84ba230139712`, unchanged by this work. The
  end-to-end test asserts that digest before and after each run.
- T5 implementation: `README.md` documents the grammar, all three variables, the three origins, the
  integrity rules, the release rebuild flow, and two troubleshooting rows. `RELEASE.md` extends the
  release-only rebuild section with the origin variables, the digest gate, and the review checklist.
- Commit evidence: not applicable. No commit was requested or created.

## Follow-up verification

- The `github` origin is covered by parsing, URL construction, and rejection tests only. A live
  release-asset download was not executed, because no verified public release asset for this engine
  exists yet and the verification runs offline.
- The `crate` origin and the `path` crate-directory origin need a real cargo build to be exercised
  end to end. The pinned crate download was not re-run: it rewrites the checked-in package input and
  needs network access. Both paths are covered by unit-level coverage of the same verification and
  build helpers.
- Full consumer verification (`pnpm run bootstrap`) was not re-run in this pass; `pnpm run pack:offline`
  and the root unit/contract suites were the recorded boundaries.
