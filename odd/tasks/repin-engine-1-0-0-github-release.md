# Repin the engine to the 1.0.0 line and close its provenance

## Objective

Make the WASM engine come from the real `1.0.0` line of the sibling core repository through the new
origin mechanism, and close the provenance chain that `upgrade-core-wasm-1-0-0.md` left open: the
vendored binary was recorded as "release commit plus an uncommitted patch".

## Problem

`corpus.lock.json` recorded the vendored binary as `c213761` (tag `v1.0.0`) plus a local patch to
`src/index.rs`, with the note "Repin to a real commit once the fix lands". The fix has since landed
upstream as `d54a86e` (sibling PR #24), so the vendored artifact is now a byte-for-byte build of a
real commit and can be recorded as one.

The requested origin, `github:ailuracollective/colander@v1.0.0`, cannot be satisfied. Two facts,
both verified rather than assumed:

- The `v1.0.0` GitHub release exists but its only asset is `libcolander.so` (3,027,008 bytes, a
  native x86-64 Linux cdylib). There is no `colander.wasm` asset, and the sibling's `release.yml`
  builds only the native cdylib; it never builds `wasm32-unknown-unknown`.
- `crates.io` has no `colander` version at all, as already recorded.

So the only origin that can produce the engine today is `path:` against a checkout of the sibling
repository.

## Authorized scope

- The vendored `packages/colander/wasm/colander.wasm` and its recorded provenance.
- `packages/colander/test/fixtures/contract-vectors/colander-0.1.0/corpus.lock.json`.
- The engine-origin documentation that names a real repository and release tag.
- The stale core-version literals in the Nest example that the repin makes wrong.
- Preservation of every unrelated uncommitted change.

## Design direction

- Build with the mechanism this repository already has, not by hand:
  `COLANDER_WASM_SOURCE=path:<checkout> pnpm --filter @ailura/colander run build:wasm:release`
  with `COLANDER_WASM_SHA256` set, so the release digest gate is exercised on a real build.
- Record the exact commit, its `git describe`, and the artifact digest. Drop `localPatches`.
- State in the documentation that the `github` origin is currently unsatisfiable, and why.
- Fix consumer version assertions the way `colander-browser` already does: assert the name, the ABI,
  and the semver shape, never a version literal.

## Constraints

- The vendored binary stays checked in; only its recorded provenance changes.
- Every artifact, comment, and message stays in English.
- Do not modify the sibling repository. The `path` origin uses a read-only `git archive` export.
- Do not weaken a test expectation to accommodate a known upstream bug. Fix the sample only if the
  sample is genuinely invalid; otherwise take the commit that carries the fix.
- No commits.

## Work units

- [x] **T1 — Prove the `github` origin unsatisfiable.** Query the release through the GitHub API and
  run the real origin: `download failed: 404 Not Found`, exit 1, no file written.
- [x] **T2 — Build the exact `v1.0.0` tag.** Export `c213761` with `git archive` and build it through
  the `path` origin. Result: a working module, digest
  `f207247c29c97038dd70f03d387ce4dcd6b4e4bfe7f40580807fd0eab97233ad`.
- [x] **T3 — Establish what the exact tag costs.** Repack, reinstall the isolated consumers, and run
  the React suite against the real engine. One failure:
  `REPEATER_NESTED_FIELD: field 'casework-context' at /fields/0/items/1 nests items under a
  repeater`. The sample has no repeater; the failing node is a `component-ref` inside a group.
- [x] **T4 — Repin to the commit that carries the fix.** Build `d54a86e`; the artifact is byte-identical
  to the vendored binary (`659ae04a…`), which proves the old "commit plus patch" build was in fact
  this commit. Record the real commit, drop `localPatches`, and restore the binary.
- [x] **T5 — Fix the drift the stale consumers were hiding.** The Nest example asserted
  `version: '0.1.0'`; it now asserts name, ABI, and semver shape like the browser package.
- [x] **T6 — Repack, reinstall, and verify.** Reinstall both isolated consumers against the new
  archive and run every suite.

## Acceptance criteria

- `corpus.lock.json` names a real commit with no local patch, and its recorded digest matches the
  vendored artifact.
- The React and Nest consumers pass against the engine installed from the packed archive, not from a
  stale tarball.
- No consumer asserts a core version literal.
- The documentation states that the `github` origin has no artifact to fetch today.

## Verification evidence

- GitHub API for `releases/tags/v1.0.0`: `tag_name v1.0.0`, assets `[('libcolander.so', 3027008)]`.
- `github:ailuracollective/colander@v1.0.0` through the mechanism: `Error: download failed: 404 Not
  Found`, process exit 1, no destination file created.
- `path:/tmp/colander-v1.0.0` (export of `c213761`): built in 10.1 s, 1,848,798 bytes, digest
  `f207247c…`. Repacked, consumers reinstalled, React suite: 47/48 with
  `REPEATER_NESTED_FIELD ... repeater children must be flat scalar fields`.
- `path:/tmp/colander-d54a86e` (export of `d54a86e`): 1,848,089 bytes, digest `659ae04a…`, identical
  to the previously vendored artifact.
- Core: `check`, `fmt:check`, `lint`, `typecheck` pass. `test:unit` 43 + 44 + 10 across the three
  packages. `test:contract` 14 tests.
- React: 48/48 and SSR 1/1 against the engine installed from the new archive.
- Nest: 7/7 unit and 5/5 e2e against the same.
- Root `check` and `fmt:check` pass. `pnpm run pack:offline` produces archives whose embedded
  `wasm/colander.wasm` hashes to `659ae04a…`.
- Not run: `pnpm run bootstrap`. This checkout has no `poc/` directory, which the bootstrap and the
  README both reference. That gap predates this work and was not introduced here.
- Pre-existing and untouched: `examples/react-app` fails `tsc -b` at `src/samples.test.ts:127`
  (`Property 'children' does not exist on type 'FormNode'`). It is a type-narrowing error with no
  relation to the engine binary, and `vite build` succeeds. It belongs to the concurrent casework
  work, not to this feature.

## Follow-up verification

- The `github` origin becomes usable the moment the sibling repository attaches a `colander.wasm`
  asset to a release. That is a change in the sibling repository plus a release action, both owned by
  its maintainer. Until then the origin is documented as unsatisfiable rather than left looking
  working.
- The `poc/` consumer referenced by the README, `RELEASE.md`, and the bootstrap script is absent from
  this checkout. Worth resolving separately: either restore it or drop the references.
- `examples/react-app` does not typecheck. Worth resolving separately so `pnpm run test:bundler` is a
  real gate again.
