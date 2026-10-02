# Replace the build plumbing with what the platform already does

## Objective

The repository carried twelve `scripts/*.mjs` files (2,101 lines) whose job was mostly to
re-implement things the toolchain or the platform already does, and to keep one code path alive
for an artifact nobody can fetch. This change deletes the plumbing that has a native equivalent and
keeps the parts that are contract.

## Problem

**1. A dead origin carried 199 lines of supply-chain defense.** `build:wasm` supported four engine
origins. Two cannot produce an engine, verified during this work:

```text
github:ailuracollective/colander@v1.0.0!colander.wasm -> 404   (the release ships only libcolander.so)
crates.io colander@0.1.0 download                             -> 403   (unreachable from here)
```

`archive-safety.mjs` (199 lines) existed to vet every tar entry of a downloaded `.crate` before
extraction: no path traversal, no symlinks, one root directory. That control is correct for remote,
untrusted input — and it was guarding a path that returns `404`. It also carried the package's only
third-party runtime dependency in the build path, the npm `tar` package.

**2. `workspace-matrix.mjs` re-implemented `pnpm -r`.** Eighty lines fanning one capability out to
three packages, sequentially, with a hand-written package list. `pnpm -r --if-present run <cap>`
is that, built in, with topological ordering.

**3. `require-contract-vectors.mjs` duplicated a test that already existed.** The seven-line shim
validated the frozen corpus in a separate process before Vitest started. `contract-corpus.test.ts`
already opens with `describe("locked contract corpus preflight")` and asserts the same thing against
the same `validateContractCorpus`. The guarantee is unchanged; it now lives in one place.

## Authorized scope

- `packages/colander/scripts/wasm-engine-plans.mjs`, `wasm-engine-source.mjs`, `build-wasm.mjs`:
  remove the `crate:` scheme, the pinned default, and the release-gate exemption it carried.
- Delete `packages/colander/scripts/archive-safety.mjs`,
  `packages/colander/scripts/require-contract-vectors.mjs`, `scripts/workspace-matrix.mjs`.
- Root `package.json`: the fan-out scripts become `pnpm -r --if-present run <cap>`.
- `packages/colander/package.json`: drop the `tar` devDependency and the preflight shim from
  `test:contract`.
- `packages/colander/test/wasm-engine-source.test.ts`, `README.md` (root and package).

## Non-goals

- `git-source.mjs` stays as it is. `git worktree add --detach` would replace its `git archive` plus
  `tar` dance with one command, but it writes metadata under `.git/worktrees` and creates a ref in
  the sibling repository. The current code is written specifically to leave the source repository
  untouched, and that is worth more than sixty lines.
- The origin grammar itself (`wasm-engine-source.mjs`, `wasm-engine-plans.mjs`, 308 lines) stays.
  It has the largest test suite in the repository and is the actual contract.
- `pack-package.mjs` and `bootstrap-consumers.mjs` stay: their checks are app logic, not plumbing.
  `pack-package.mjs` could read the tarball with `tar -tf` instead of the npm `tar` package, which
  would drop the last third-party dependency in `scripts/`; that is a separate, smaller change.
- No change to the vendored `wasm/colander.wasm` or the frozen contract vectors.

## Design

**No default origin.** With `crate:` gone there is nothing that can be a default, so
`COLANDER_WASM_SOURCE` became required. A blank or absent value now fails with the three accepted
forms instead of silently resolving to a download that returns `404`. This is the same principle as
the retirement of `published` in `wrapper-abi-parity.md`: a default that cannot work is a trap, not
a convenience.

**Every release build needs a digest.** The `crate:` origin was the only one exempt from
`--require-digest`, because it carried a pinned in-code archive digest. With it gone the exemption
goes with it: `build:wasm:release` now demands `COLANDER_WASM_SHA256` for every origin. The gate is
stricter, not looser.

**The test count went down by one, on purpose.** The "defaults to the pinned crate" case asserted
behavior that no longer exists, and the "keeps the pinned default crate gated by its in-code archive
digest" case asserted an exemption that no longer exists. Replacing a test of a dead default with a
test that a missing origin is refused is the change; the count is incidental.

**`test:contract` gained two packages.** The old matrix ran `test:contract` in `colander` only. With
`pnpm -r` it runs in all three, so the client and browser contract suites now run as part of that
command rather than only under `test:unit`.

## Acceptance

- `COLANDER_WASM_SOURCE` unset fails with the accepted forms and exit code 1.
- `COLANDER_WASM_SOURCE=git:<sibling>@<commit>` still produces a byte-identical artifact.
- `COLANDER_WASM_SOURCE=path:<vendored .wasm>` still copies the artifact byte for byte.
- Workspace `lint`, `typecheck`, `fmt:check`, `build`, `test` and `test:contract` all pass.
- `packages/colander` no longer depends on the npm `tar` package.

## Tasks

- [x] T1 Remove the `crate:` scheme from the origin grammar.
- [x] T2 Delete `archive-safety.mjs` and the crate branch of `build-wasm.mjs`.
- [x] T3 Replace `workspace-matrix.mjs` with `pnpm -r`.
- [x] T4 Fold the corpus preflight into its test.
- [x] T5 Update the tests and both READMEs, then run everything.

## Commits

None. The repository still holds the whole uncommitted monorepo refactor and no commit was
requested.

## Result

372 lines of plumbing deleted (`archive-safety.mjs` 199, `workspace-matrix.mjs` 80,
`require-contract-vectors.mjs` 7, plus 86 removed from the grammar and the build script), one
third-party build dependency removed, and the release digest gate made unconditional. Everything the
deleted code protected is now either impossible (an artifact that cannot be fetched) or already
covered (`the corpus preflight is the first case of the contract suite`).
