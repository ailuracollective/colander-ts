# Upgrade the pinned Colander core to 1.0.0

## Objective

Move `@ailura/colander` from the vendored `v0.1.0-37-g80c8f35` WebAssembly
build to the current `colander 1.0.0`, and fix everything in this repository
that the newer core legitimately rejects. No new features: the goal is that the
whole workspace is green against a core whose version it can state honestly.

## Problem

The vendored `packages/colander/wasm/colander.wasm` is a build from
`v0.1.0-37-g80c8f35`, a commit 37 behind the deleted `v0.1.0` tag. The sibling
repository is now at `1.0.0` (`c213761`). Three things follow, all verified
against both binaries:

1. **The old binary has a defect the current one fixed.** In `Complete` mode it
   returned `CALCULATED_VALUE_MISMATCH` for a calculated field's own value, even
   when the value was correct. The current core compares correctly
   (`submitted=Int(6)`, `calculated=Double(6.0)`, equal). This is why
   `odd/tasks/client-drop-duplicated-core-logic.md` had to strip calculated
   answers client-side: the workaround hid a stale-binary defect.
2. **The contract moved.** A present-but-null `uiSchemaJson` is now rejected
   with `'uiSchemaJson' must be a string when present`
   (`src/ffi/envelope.rs:72`). The vendored corpus stores `null` for components
   without a UI schema, so 11 compile vectors no longer replay.
3. **The samples predate D-4.** The `casework` sample nests `items` under a
   repeater child, which the current core rejects with `REPEATER_NESTED_FIELD`
   (`SPEC.md` D-4): repeater children must be flat scalar fields.

## Provenance problem

`packages/colander/scripts/build-wasm.mjs` downloads the crate from crates.io
and verifies a SHA-256. **That path is dead for every version.**
`https://crates.io/api/v1/crates/colander` returns `crate 'colander' does not
exist`, and `docs/releases.md` in the sibling repository states that the
premature `0.1.0` publication was deleted and that crates.io therefore has no
`colander` version at all. The `1.0.0` release was tagged and pushed but never
published.

The current binary was therefore built from a local sibling checkout, and this
repository has no record of which commit beyond `corpus.lock.json`. This task
pins that record explicitly instead of leaving it implied.

## Scope

- Rebuild the vendored wasm from the sibling repository at a pinned commit and
  record the provenance in `corpus.lock.json` (`version`, `commit`, `describe`).
- Fix the vector-replay harness so component references with an absent UI schema
  omit the key instead of sending `null`, matching the declared
  `ComponentReference.uiSchemaJson?: string` type.
- Correct `binding.test.ts`, which asserts the core reports `"0.1.0"`.
- Correct the `casework` React sample so repeater children are flat scalars
  (D-4), in both the parsed sample and the expected facts.
- Re-check the remaining React assertions against the current core and correct
  any that encoded old behaviour.
- Document the sibling-repository provenance where the README describes the
  crates.io download, and state that the crates.io path is currently dead.

## Out of scope

- Publishing `colander` to crates.io. That is a human release decision owned by
  the sibling repository (`docs/releases.md`).
- Re-recording the golden vectors. They are frozen and the harness, not the
  vectors, is what no longer fits. Only the harness adapts.
- The `REPEATER_NESTED_FIELD` rule itself and the calculated-value comparison
  in the core: both verified correct at `1.0.0`, no change proposed.
- The `@ailura/*` package versions. They are the binding's own version and
  are independent of the core's `versionInfo`.

## Constraints

- The vendored binary is checked in. It stays checked in; only its contents and
  the record of its origin change.
- No path dependency and no dev-dependency may be added to the core crate. This
  task does not touch the sibling repository's manifests.
- Every artifact, comment, and message stays in English.
- No `…Json` field may be handed to the ABI as anything but text.
- The vector count assertions must keep passing: a shrunken corpus is a failure,
  not a pass.

## Work units

- [x] **T1 — Repin the vendored binary.** Rebuilt from the sibling repository at
  `c213761` (`v1.0.0`), recorded in `corpus.lock.json`, and added
  `vectorsRecordedFrom` so the frozen files are not mistaken for a 1.0.0
  recording. `binding.test.ts` now asserts `1.0.0`, and a new test in
  `contract-corpus.test.ts` fails if the lock and the loaded binary disagree —
  the check whose absence let the version drift unnoticed.
- [x] **T2 — Fix the vector-replay harness.** `componentReferences()` drops
  null-valued keys, turning the recorded "absent" into the absent the
  `ComponentReference.uiSchemaJson?: string` type means. All seven groups
  replay, 30/30, with every recorded count intact and no vector edited.
- [x] **T3 — The `casework` sample needed no change.** The sample was always
  legal; the core was wrong. It is fixed in the sibling repository
  (`odd/tasks/fix-group-nested-repeater-rule.md`): `index_answer_fields` called
  the row-children builder for any field with `items`, so a group nested in a
  group was refused with `REPEATER_NESTED_FIELD` naming a repeater that did not
  exist. `SPEC.md` D-4 and `docs/documents.md:199-202` both scope the rule to
  repeaters, so the code was brought into line with the published contract.
  `groups_may_nest_under_a_group` pins it.
- [x] **T4 — Re-verify the workspace.** All green against the repinned binary:
  core binding 30/30, client 44/44, browser 10/10, React example 48/48, and
  `poc` reports "Packed consumer smoke passed for all three packages."

## Outcome

The calculated-value work in `odd/tasks/client-drop-duplicated-core-logic.md` is
now validated rather than merely correct: the React assertion that the stale
binary made unsatisfiable passes, because the current core compares a
calculated field's own value properly.

`packages/colander-browser/test/web-client.test.ts` no longer repeats the core's
version literal. It asserts the name and ABI and matches a semver shape, leaving
the exact version to the one owner: the lock assertion in
`packages/colander`.

Two things were learned the hard way and are now guarded: the crates.io download
in `scripts/build-wasm.mjs` cannot work for any version, and the vendored binary
is built from a sibling checkout whose commit has to be recorded by hand.

## Outstanding

- The sibling fix is uncommitted, so the vendored binary is one commit plus a
  local patch, recorded as such in `corpus.lock.json`. Commit the fix and repin
  to the real commit to close the provenance chain.
- `scripts/build-wasm.mjs` still points at a crates.io version that does not
  exist. It is dead code for every version and should either be replaced with a
  sibling-checkout build or removed once a release is published.
- Three of the six `replayExclusions` in the lock claim "the published ABI does
  not support nested answer arrays/objects", which `E-8` suggests the current ABI
  does support. They were left in place because removing them changes the
  recorded inventory; that is a separate, deliberate change.
- The whole monorepo is untracked on `feat/nest-colander-example`, so none of
  this is committed.

## Acceptance criteria

- `versionInfo()` from the loaded binary reports `1.0.0`, and
  `binding.test.ts` asserts that value against the lock rather than a second
  hardcoded literal.
- All seven vector groups replay with their recorded counts, against the 1.0.0
  binary.
- The React example suite is green.
- The `client-drop-duplicated-core-logic` suite is green, including the
  calculated-value case that the old binary made impossible.
- `corpus.lock.json` names the exact commit the binary was built from, including
  the uncommitted patch, and states that the crates.io path is currently dead.

## Evidence

- `https://crates.io/api/v1/crates/colander` — `crate 'colander' does not exist`.
- `docs/releases.md` (sibling) — "crates.io therefore has no `colander` version
  at all".
- `src/ffi/envelope.rs:72` — the present-must-be-a-string rule.
- `SPEC.md` D-4 — repeater children are flat scalar fields.
- `SPEC.md` V-8 — the calculated-value comparison the current core satisfies.
- Commits: none. The working tree carries the whole untracked monorepo on
  `feat/nest-colander-example`, so a work-unit commit is not possible without
  first committing that restructure.
