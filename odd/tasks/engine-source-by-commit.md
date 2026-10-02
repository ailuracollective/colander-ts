# Select the engine source by commit

## Objective

Add a `git:` engine origin so the WASM engine can be built from one specific commit of the core
repository, resolved by the build itself, without a manual `git worktree` or `git checkout` dance in a
scratch directory.

## Problem

Today a commit can only be selected indirectly: the operator exports or checks out that commit by
hand and points `path:` at the result. `repin-engine-1-0-0-github-release.md` did exactly that
(`git archive d54a86e | tar -x -C /tmp/...`), which works but keeps the commit selection outside the
build and outside any recorded contract. The commit is the most precise identity a source can have,
and it should be expressible directly.

The `github:` origin cannot cover this case: release assets exist per tag, never per commit, and the
`v1.0.0` release publishes no WebAssembly asset at all.

## Authorized scope

- `packages/colander/scripts/wasm-engine-source.mjs`: the `git:` grammar.
- `packages/colander/scripts/git-source.mjs`: materializing the selected commit.
- `packages/colander/scripts/build-wasm.mjs`: wiring the new origin.
- Focused tests for the grammar, the release gate, and the materialization.
- `README.md` and `RELEASE.md` for the new origin.
- Preservation of every unrelated uncommitted change.

## Design direction

- New origin `git:<repository>@<ref>`, where `<repository>` is a URL or a local path, and `<ref>` is a
  full commit SHA, a tag, or a branch. The scheme is `git:` because a commit is not a release.
- A local repository is exported with `git archive <ref>`, which is read-only: it never touches the
  repository's working tree, index, or refs, and it needs no network. That makes a commit-selected
  build fully offline against the sibling checkout.
- A URL is materialized in a temporary directory with `git init`, a single `git fetch --depth 1` of
  the ref, and a checkout of the fetched commit. History is never cloned.
- The resolved commit SHA is content-addressed, so it is the integrity anchor. The build log prints
  the resolved commit. The existing release gate already requires `COLANDER_WASM_SHA256` for every
  origin except the pinned default crate, so a `git:` release build is gated with no new rule.
- The materialized tree must contain `Cargo.toml` at its root; the artifact name is discovered from
  the cargo release directory, as the local `path:` crate origin already does.
- The exported tree lives in the temporary directory, so no engine source is written outside the
  build's own scratch space.

## Constraints

- Never mutate the source repository: no fetch, no checkout, no worktree registration, no ref
  creation. `git archive` and an isolated temporary clone only.
- Technical artifacts and documentation remain in English.
- Ordinary functional verification; strict TDD is not configured.
- Tests must be offline and must never overwrite the checked-in WASM input.
- Do not change the meaning of the existing `crate:`, `github:`, or `path:` origins.
- No commits.

## Work units

- [ ] **T1 — `git:` grammar.** Parse `git:<repository>@<ref>`, classify a local path against a URL,
  validate the ref, and expose the plan.
- [ ] **T2 — Materialization.** Implement the read-only local export and the shallow URL fetch, and
  return the resolved commit.
- [ ] **T3 — Build wiring.** Route the `git:` plan through the same crate build, module verification,
  and digest gate as every other origin.
- [ ] **T4 — Tests.** Cover the grammar and its rejections, the release gate for `git:`, and a real
  local materialization by SHA and by tag against a temporary fixture repository.
- [ ] **T5 — Documentation and end-to-end proof.** Document the origin, then rebuild the engine with
  `git:` against the sibling repository and confirm the artifact is byte-identical to the vendored
  one.

## Acceptance criteria

- `COLANDER_WASM_SOURCE=git:<local-repo>@<commit>` builds that exact commit, offline, without
  modifying the source repository.
- `COLANDER_WASM_SOURCE=git:<url>@<commit>` builds that commit from a shallow temporary clone.
- A tag or a branch is accepted as a ref; a malformed spec is rejected with an actionable message.
- The resolved commit is printed and the produced artifact still passes the shared module contract.
- `build:wasm:release` still requires `COLANDER_WASM_SHA256` for a `git:` origin.
- The existing three origins keep their exact behavior.

## Progress

- Feature document created before the first source write.
- Effective TDD mode: ordinary functional verification; strict TDD is not configured.
- Engram mirror: created alongside this document.
- Route: implemented directly. Two `gentle-ai-worker` delegations for the previous feature failed with
  "assistant reported an error" after zero tool calls, so writer delegation is not retrying here.
- No commits are authorized by the current user request.

## Verification evidence

- Pending.

## Follow-up verification

- Pending.
