# Harden package developer experience

## Objective

Remove the confirmed DX weaknesses across the Colander package workspace, isolated examples, and package boundaries. The result must provide a reproducible local-to-published flow, consistent command coverage, stable runtime/error contracts, useful public types, and tests that exercise real package consumers instead of only source imports.

## Problem

The current workspace can appear healthy while leaving important work uncovered: recursive root scripts skip packages without optional scripts, the examples depend on an ignored local tarball with fixed lockfile integrity, client/browser package publication can omit or reuse stale `dist` output, and there is no single bootstrap for the isolated consumers. Package lifecycle, error taxonomy, and public types are duplicated or weaker than their documentation implies. Contract vectors can be silently skipped, and browser/HTTP/package-boundary behavior is not fully verified.

## Authorized scope

- Root workspace scripts, package manifests, package-local build/test configuration, lockfiles, and packaging flow.
- All three packages under `packages/`.
- Isolated examples under `examples/nest-app` and `examples/react-app` where required for consumer validation, bootstrap, and package wiring.
- Public lifecycle/error/type contracts, WASM loading boundaries, and their focused tests.
- Consumer smoke tests and deterministic contract fixtures required to verify packed packages.
- Root/package/example documentation, Node/pnpm compatibility, and release metadata.
- Preservation of existing behavior and the user's unrelated uncommitted work.

## Design direction

- Make `@ailura/colander-browser` the canonical browser lifecycle adapter and have the React example consume it instead of maintaining a parallel local WASM lifecycle facade.
- Keep `@ailura/colander-client` source-agnostic and make its discriminated error contract the neutral boundary.
- Keep `@ailura/colander` as the sole owner of `colander.load()` and the WASM asset.
- Separate local/offline packaging from release packaging that rebuilds WASM.
- Use explicit package commands and a root orchestration command that fails when a required package script is missing.
- Treat packed-package smoke tests and browser-runtime tests as release boundaries, not optional examples.

## Constraints

- Technical artifacts and documentation remain in English.
- Ordinary functional checks are required; strict TDD is not configured.
- Do not reset, clean, overwrite, or revert unrelated user changes.
- Do not use remote operations, push, pull requests, or destructive Git operations.
- Do not commit unless the user explicitly asks for a commit; record commit evidence as not applicable.
- Keep example application behavior unchanged except for package wiring, bootstrap, runtime correctness, and focused contract tests.
- Keep dependencies directional: `colander-browser -> colander`; `colander-client` must not depend on the core or a concrete transport.
- Do not silently accept a missing WASM, missing `dist`, or missing consumer fixture; verification must fail with an actionable message.

## Work units

- [x] **T1 — Canonical workspace and release flow.** Add complete per-package scripts and root orchestration for build/check/fmt/lint/test/typecheck/pack; add clean and offline/prepare package lifecycle; add a bootstrap/verify command for both isolated examples; make artifact generation deterministic. Route: delegated writer; trigger: coordinated multi-file workspace and packaging changes.
- [x] **T2 — Consumer-safe package boundaries.** Make the browser package the React consumer's canonical adapter; preserve one transport port; unify discriminated error normalization across core/client/browser/HTTP; export required public types; enforce readonly/form-definition and component compilation ergonomics without changing core behavior. Route: delegated writer; trigger: cross-package public API changes.
- [x] **T3 — Runtime and contract hardening.** Make `validateSchema` distinguish ordinary validation failures from core errors; define and test Node/browser WASM loading boundaries; make contract vectors explicit and portable; add packed-package and browser/bundler smoke coverage; add HTTP response/error contract tests. Route: delegated writer; trigger: source, test, and runtime contract changes across packages.
- [x] **T4 — Tooling and release documentation.** Align Node, pnpm, TypeScript, Vite, and Vitest support matrices; add missing package metadata and release guidance; document the one-command bootstrap and offline versus publish workflows; remove active documentation drift while preserving historical task records. Route: delegated writer; trigger: multi-file documentation/configuration alignment.
- [x] **T5 — Verification and readback.** Run focused tests, typechecks, builds, lint/checks, clean package packing, packed-consumer smoke tests, and example checks; record every result and known environmental limitation. Route: fresh verification worker; parent retains structural readback.

## Acceptance criteria

- Root commands have an explicit, complete package matrix and do not silently skip a required package capability.
- A clean checkout can build, pack, and smoke-test all three packages without relying on stale local output.
- `@ailura/colander-client` and `@ailura/colander-browser` produce deterministic, publishable `dist` and declaration outputs.
- The examples have a documented single bootstrap/verification path and consume the current package artifacts, not a stale ignored tarball.
- Core, client, browser, and HTTP error categories remain distinguishable through adapter boundaries.
- React consumes the canonical browser lifecycle package and does not retain a second lifecycle/error implementation.
- `validateSchema` returns `{ valid: false }` only for an ordinary schema validation result and preserves typed runtime errors.
- Public package types needed by consumers are exported; readonly promises and compile requests are reflected by the actual types.
- Contract vectors are explicit about required fixtures, portable across supported filesystems, and have a separate contract-test command.
- Node/pnpm/toolchain requirements are consistent across manifests, examples, and documentation.
- All applicable checks are executed and their results recorded; no unverified success is claimed.

## Progress

- Feature document created before the first source write for this remediation.
- Effective TDD mode: ordinary functional verification; strict TDD is not configured.
- Engram mirror: pending; Engram tools are not exposed in this runtime.
- Route: one delegated writer for implementation, followed by an independent verification worker. No commits are authorized by the current user request.

## Verification evidence

- T1 implementation: added the explicit workspace capability matrix, complete package scripts, clean/pack lifecycle helpers, release-only WASM separation, deterministic archive checks, and the offline consumer bootstrap. Final `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run fmt:check`, `pnpm run test`, and `pnpm run pack` all passed.
- T1 focused suites: `pnpm --filter @ailura/colander run test:unit` passed (16 tests), `pnpm --filter @ailura/colander-client run test:unit` passed (41 tests), and `pnpm --filter @ailura/colander-browser run test:unit` passed (10 tests).
- T2 implementation: moved the neutral failure categories and structural adapter into `@ailura/colander-client`, made browser errors a compatibility specialization of that model, exported `WasmSource`, marked public model/result properties readonly where safe, and threaded `components` through `createCompileRequest`. React's local WASM file is now a thin factory over `createWebColander`; it no longer owns loading, caching, recovery, or error mapping.
- T2 checks: `pnpm --filter @ailura/colander run typecheck`, client `run check`/`test:unit` (41 tests), browser `run check`/`test:unit` (10 tests), and React `tsc -b`/`test` (48 tests) passed. The React build emitted the 1.49 MB WASM asset and retained the documented non-fatal `node:fs/promises` browser-externalization warning.
- T3 implementation: `validateSchema` now converts only `validation` envelopes to `{ valid: false }`; `invalid_request` and `panic` remain typed `ColanderError`s. Added explicit Node/browser `loadBundledWasm` seams and focused boundary tests, portable `fileURLToPath` vector discovery with no green skip, HTTP malformed/4xx/5xx/non-JSON/error-kind tests, and one `poc/` packed consumer covering all three archives, declarations, exports, and WASM.
- T3 checks: `pnpm --filter @ailura/colander run test:unit` passed (16 tests). `pnpm run test:contract` now passes 2 files and 13 tests: seven focused preflight tests plus all six locked replay groups. The checked-in corpus is the default; no sibling fallback is used. `pnpm --dir examples/react-app run test` passed (7 files, 48 tests), including the HTTP adapter suite.
- `pnpm --dir poc install --offline --frozen-lockfile` passed; `pnpm --dir poc run typecheck` passed; `pnpm --dir poc run smoke` passed for all three packed packages; `node --check poc/consumer.mjs` passed.
- T4 implementation: aligned runtime Node `>=20.19.0`, pnpm `12.3.4`, development-engine ranges, and toolchain distinctions across manifests; added the root bundler command, active README quick paths/troubleshooting, package/example lifecycle documentation, and [`RELEASE.md`](../../RELEASE.md). The existing MIT metadata is retained and the missing approved license file is documented rather than invented.
- `pnpm exec vp check` and `pnpm exec vp fmt --check` passed after excluding the isolated `poc/` consumer from root formatting/lint and keeping its own typecheck/smoke scripts. `pnpm run bootstrap` passed end-to-end: offline root install, all three package builds/packs, Nest install/build/tests (7), React install/build/tests (48), React SSR (1), and `poc` typecheck/smoke.
- Full interactive browser-runner coverage is unavailable in this runtime. The deterministic fetch-seam test and the React Vite production build are the recorded narrow browser/bundler boundary. The ordinary bootstrap uses `--config.minimum-release-age=0` only for offline frozen installs because registry release-age metadata cannot be queried offline; lockfile and package integrity checks remain enabled.
- T5 final checks: `pnpm run typecheck`, `pnpm run check`, `pnpm run fmt:check`, `pnpm run lint`, `pnpm run test:unit` (core 16, client 41, browser 10), `pnpm run test:contract` (2 files, 13 tests), `pnpm run test:bundler`, `pnpm run pack:offline`, `pnpm run bootstrap`, and `git diff --check` all passed. Bootstrap also passed Nest unit/e2e (7/5), React build/tests/SSR (48/1), and packed POC typecheck/smoke. No clean or release WASM rebuild was run.
- T5 completed for the authorized local/offline scope: the final parent run observed `pnpm run typecheck`, `pnpm run check`, `pnpm run fmt:check`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:contract`, `pnpm run test:bundler`, `pnpm run pack:offline`, `pnpm run bootstrap`, and `git diff --check` passing. The bootstrap additionally observed Nest unit/e2e (7/5), React build/tests/SSR (48/1), and packed POC typecheck/smoke. Destructive `pnpm run clean` and network/Rust-dependent `pnpm run release:pack` were intentionally not run; they are separate release operations, not unmet DX acceptance criteria.

## Follow-up verification

- Browser lifecycle normalization now uses the shared structural `toColanderTransportError` adapter, recognizes neutral panics, and invalidates the cached core for structural panic failures. The focused browser suite passes with 10 tests.
- HTTP error parsing now accepts every neutral failure kind, validates optional detail text, and rejects malformed bodies. The final React suite passes with 48 tests, including the expanded HTTP contract tests.
- Public request, result, node, and rule-evaluation types now expose readonly array/map contracts across the core and client packages. Component references remain copied at the compile-request boundary.
- Packing now runs the `prepack` lifecycle, validates every manifest export target and archive entry, forces offline mode, and creates byte-identical stable local aliases alongside versioned publish archives. Repeated `pnpm run pack` runs produce identical archive digests.
- Fresh-dist invariant: all three publishable manifests use `prepack: pnpm run clean && pnpm run build`, while `pack` delegates to `scripts/pack-package.mjs`; the clean helper removes only the current package's `dist`, and core WASM validation remains in the pack script. `packaging.test.ts` asserts the lifecycle contract and exercises a temporary stale dist, and manual client/browser sentinel checks confirmed stale dist files were absent from both dist and archives.
- Contract corpus tests now use `tmpdir()` plus `path.join`; the only default lock is `packages/colander/test/fixtures/contract-vectors/colander-0.1.0/corpus.lock.json`. The explicit `COLANDER_VECTORS` override requires an adjacent lock and never searches a parent or sibling lock.
- `poc/package.json` now carries the same Node development engine policy (`devEngines.runtime` and pnpm `12.3.4`) as the root and package manifests.
- `.gitignore` now ignores only `examples/react-app/.vitest/` generated reports; the concurrent casework task and source edits were not modified.
- Consumer package manifests and lockfiles now reference the stable aliases. Their integrity entries were regenerated with pnpm's offline `--lockfile-only --force --fix-lockfile` flow. `pnpm run bootstrap` verifies archive SHA-512 lockfile entries, installed manifests, export targets, and dependency direction; it also runs Nest `test:e2e`. The full bootstrap passes.
- Contract corpus resolution: copied the exact five JSON files from sibling commit `80c8f358f33983efe6aad46f753db28321934938` (`v0.1.0-37-g80c8f35`) into `packages/colander/test/fixtures/contract-vectors/colander-0.1.0/`; their SHA-256 values are `7da1e0a6341d26816fab92103b410425e070e0f54a39071af8f696afeda51a27`, `fe9b626dbd01ae03d3b79912173814770d58913012d3528cd063c0dc1b0f43b5`, `42b3b1aa9078538764886ddd6e26c6302d0695a41c9c399c49738afcca5b2a7c`, `2a92d00beaafc2bd0355ca261a5d1a6614d8394dda32fa35f4af50024de4edb0`, and `7b8d157cf123bba2f68569e0f62a619a6168378a78316ad06d49ca7544cdb254` as recorded in the adjacent `corpus.lock.json`.
- `corpus.lock.json` records core `colander@0.1.0` ABI 1, source label/commit/describe, raw record counts, replay inventory (`hash 8`, `semver 5`, `validate 58`, `validateErrors 5`, `compile 13`, `rules 34`), and every explicit ABI-boundary exclusion with a reason. The exclusions are checked against the vendored records; nothing is silently skipped.
- Contract preflight and focused tests reject missing, malformed, non-array, digest-mismatched, stale-exclusion, and inventory-mismatch corpora. The exact checked-in corpus and all six replay groups pass.
- Final non-contract verification passed: root `check`, `fmt:check`, `lint`, `typecheck`, `test`, `test:bundler`, `pack:offline`, `bootstrap`, package unit suites, React tests/typecheck, Nest unit/e2e tests, and `git diff --check`.
- Engram mirror: pending; Engram tools are not exposed in this runtime.
- Native RDD review was attempted after final normalization. Selectorless STATUS required the provider-issued intended-untracked selection; the explicit selection returned `immutable_review_transport_unsupported` before review authority creation. With explicit user consent, one sanitized occurrence comment was added to the canonical Gentle AI issue #4805; no review receipt, lineage, reviewer result, or delivery authority was created. Functional verification remains the verification of record.
