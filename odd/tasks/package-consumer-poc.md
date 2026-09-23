# Create a package-consumer POC

## Objective

Create an isolated `poc/` project inside the repository that installs the locally packed
`@ailuracode/colander` archive and exercises its public API as a real Node consumer.

## Problem

The repository tests import the source tree directly. They do not verify the published package export
map, the `dist`/`wasm` layout after packing, or a consumer's package-manager resolution. A small
standalone POC is needed to catch packaging and WASM-loading regressions.

## Scope

- Add `poc/package.json` as a private ESM Node project with a local tarball dependency.
- Add `poc/consumer.mjs` as a deterministic smoke/behavior scenario using the public loader and
  multiple public operations.
- Add `poc/README.md` with prerequisites, commands, and expected behavior.
- Do not change the library source, root package metadata, or root test configuration.

## Constraints

- Test the package as `@ailuracode/colander` through the tarball, not through a workspace link or
  source import.
- Keep the consumer ESM-only and require Node 20 or newer.
- Keep the POC deterministic: no network calls or hidden global state.
- Use English for technical artifacts and comments.
- The POC must fail loudly with useful output when the package or WASM artifact cannot load.

## Work units

- [x] **T1 — Scaffold the isolated consumer.** Create the private package manifest and scripts. Route:
  delegated writer; trigger: the implementation touches multiple non-trivial files.
- [x] **T2 — Implement the public API scenario.** Add the Node consumer covering package loading,
  version identity, compilation, rule evaluation, response validation, and a negative validation
  path. Route: delegated writer; trigger: coordinated multi-file behavior.
- [ ] **T3 — Document and verify.** Add usage instructions, install the tarball, run the consumer,
  and record exact results. Route: delegated writer for the focused runtime check; parent retains
  final structural readback.

## Acceptance criteria

- `poc/package.json` installs the local `ailuracode-colander-0.1.0.tgz` archive.
- `node consumer.mjs` exits with code 0 and prints the package identity plus a successful scenario.
- The consumer imports only the public package name and demonstrates at least one valid and one
  invalid response outcome.
- The README explains how to build the archive before installing the POC.
- No root source or root configuration is modified.

## TDD and checks

- Effective TDD mode: not configured; ordinary functional checks are required.
- Build/package prerequisite: `pnpm pack` from the repository root (may rebuild WASM).
- Focused runtime check: `pnpm --dir poc install --frozen-lockfile` when a lockfile exists, otherwise
  `pnpm --dir poc install`; then `pnpm --dir poc run smoke`.
- Structural checks: inspect the final `poc/` files and the root diff/status.
- If Rust/WASM tooling is unavailable, report the exact build failure without fabricating a runtime
  result.

## Work-unit and delivery forecast

- Estimated authored change: under 400 lines.
- Delivery strategy: `ask-on-risk` (default).
- Rollback boundary: remove `poc/` and any generated local archive/install artifacts; no library
  behavior is affected.
- Commit evidence: pending; this repository is unborn and the user did not request a commit.
- Engram mirror: pending; Engram tools are not exposed in this runtime.

## Progress

Feature document created before the first source write. The implementation and verification evidence
will be added after each work unit.

- T1 implemented and checked: `poc/package.json` is private ESM, requires Node `>=20`, uses `pnpm@12.3.4`, defines `smoke`, and depends on `file:../ailuracode-colander-0.1.0.tgz`. Manifest contract check passed.
- T2 implemented and checked: `poc/consumer.mjs` imports the public package, verifies `colander@0.1.0` and ABI 1, compiles a deterministic form, evaluates a BMI rule, accepts a valid response, and rejects `CALCULATED_VALUE_MISMATCH`. `node --check` and the package-backed smoke run both passed.
