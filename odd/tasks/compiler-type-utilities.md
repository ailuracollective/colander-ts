# Per-type utilities in the compiler

## Objective

Give every materializable field type its own utilities inside `@ailura/colander-compiler`, so the
per-type decisions a control has to make are written once, in the package that already owns the
core's semantics, instead of once per consumer. The numeric step is the case in point: it is
derived today in `examples/react-app/src/components/colander/shared.tsx:26` for `number` and,
differently and contradictorily, inline in `integer.tsx:33`.

The utilities are the third thing the compiler publishes. It already publishes the names and
ordering a control needs at build time (`plan.ts`, `contracts.ts`) and the framework-neutral
binding a control needs at runtime (`runtime.ts`). What it does not publish is the *decision*: what
the core's declared properties mean for one type, derived once.

## Problem

Every consumer that writes a control re-derives the same per-type facts and gets them slightly
wrong, because nothing in the repository says what the right answer is:

- `number` and `integer` derive `step` from `multipleOf` through two different rules, written in
  two different files, and neither rule is tested. `stepFor` is a function; the integer rule is an
  expression in a JSX attribute.
- `reportNumber` (`shared.tsx:39`) is the only value coercion in the app, it is `parseFloat` for
  both numeric types, and its comment in `integer.tsx:9-13` claims the answer is parsed as an
  integer. The code and its own documentation disagree.
- The whole temporal layer — `ClockTime`, `MIDNIGHT`, the three wire patterns, the
  February-30th and year-under-100 round-trip guards, `atTime` — is ~150 lines of careful code in a
  React example, in a test suite that runs `environment: "node"` with no DOM and therefore cannot
  reach it. It is not covered by a single assertion.
- `choice` degrades a list-valued answer to a single-select widget through a module-private
  sentinel string (`choice.tsx:26`) that is chosen without checking it against the options, so a
  document with an option literally equal to `"__colander_no_answer__"` renders a wrong selection.
- Nothing rejects an integer answer that a control rounded. The core is strict about this on
  purpose (`form-definition.ts:588-596`: converting in the client "would hide the error the caller
  needs to see"), and the utilities must keep it reachable.

The compiler is where the answer belongs, because the compiler is the only place that already
reads the core's table. `SEMANTIC_TYPE_DESCRIPTORS` states which properties each type carries;
nobody states what they mean.

## The rule that decides every utility

**The core declares, the client does not invent.** A utility derives only from properties the core
declares for that type, and where the core is silent it produces a non-restrictive answer rather
than a guessed constraint. The locked contract corpus decides where "the core is silent" is:

- `multipleOf` on `number` is enforced. `validate.json:4122` → `"Field 'n' must be a multiple of
  0.5."`
- `multipleOf` on `integer` is **accepted and never enforced**. `validate.json:4232` and `:4281`
  both declare `multipleOf: 0.5` on an `integer` and both return zero errors. So the integer step
  must not follow `multipleOf` blindly: a step that does not divide evenly would silently reject
  integers the core accepts.
- `decimalPlaces` has **no validation presence at all** — zero occurrences in `validate.json`. So a
  step derived from it is a precision hint for the control, never a constraint, and it is documented
  as such.
- An empty text field: the core decides whether `""` is an answer. The text utilities forward the
  string unchanged and do not substitute `null`.

A utility that cannot be justified by a declared property is not written. That rule is why `text`
and `textarea` end up with a deliberately thin surface: they declare `minLength`, `maxLength` and
`pattern`, and forwarding a name is what `controlPropsFor` (`runtime.ts:87`) already does, so
inventing a utility for them would be ceremony.

## Scope

- Add `src/utilities/` to `@ailura/colander-compiler`: one module per type family, a
  `DeclaredProperties<T>` reader derived from the core's table, and a type-keyed registry.
- Publish it as the `./utilities` subpath, re-exported from the root like `./runtime` is, and add
  the Node-builtin-free assertion to the entry-point test.
- Rewrite the nine `examples/react-app` controls to consume the utilities, and delete the
  duplicated logic in `shared.tsx`.

## Constraints

- No framework, no markup element, no styling, no component name. The compiler names a semantic
  concept (`step`, `answerFrom`) and returns a plain value; a consumer's control is what puts it on
  an element.
- Every utility takes a type it cannot be used with the wrong one: `number` constraints and
  `integer` constraints are distinct types, so `stepForInteger` cannot be handed a number field's
  `decimalPlaces`.
- The registry is exhaustive over `MaterializableFieldType` at compile time, so a type added to the
  core's table without its utilities is a build error, not a runtime `undefined`.
- The wire formats do not change: `YYYY-MM-DD`, `HH:mm`, `YYYY-MM-DDTHH:mm`, the shapes the samples
  and the core already carry.
- A control may not round, clamp, or substitute an answer. It reports what the user produced and
  lets the core reject it.
- `common()` (`shared.tsx:10`) stays in the app. It folds `readOnly` into `disabled`, which is
  element plumbing about the consumer's own markup, not a per-type derivation, and the host contract
  deliberately keeps `disabled` and `readOnly` separate.
- Technical artifacts, code, tests, and docs remain in English.
- Effective strict TDD is not configured; every utility ships with a test that fails without it.
- No commit, push, pull request, or remote operation is authorized: this worktree already holds
  unrelated uncommitted changes from other features.

## Authorized scope

`packages/colander-compiler` (new `src/utilities/`, the `./utilities` export, its tests, the
entry-point test, its README), `examples/react-app/src/components/colander/**`, and this document.
Existing unrelated worktree changes must remain untouched.

## Delivery forecast

- Estimated authored change: approximately 700–1100 lines across seven family modules, the
  registry, the compiler's tests and manifest, the nine controls, and documentation.
- Delivery strategy: `ask-on-risk`; no remote delivery action.
- Rollback boundary: delete `src/utilities/` and the `./utilities` export; restore the nine controls
  and `shared.tsx` to their current per-type derivations.

## Work units

- [x] **T1 — Declare the utility contract.** `DeclaredProperties<T>` derived from the core's table by
  the same pattern `contracts.ts` already uses, the per-type constraints aliases, the `./utilities`
  subpath, and the Node-builtin-free assertion. Route: bounded writer. Trigger: new module surface
  plus manifest. Comes first because every family types its parameters with it.
  Evidence: `src/utilities/contract.ts` reuses the `DescriptorFor` → `ControlProperties` →
  `ControlSemanticProps` chain from `contracts.ts` and makes it distributive over `T`, so a concrete
  type resolves exactly and an unresolved one behaves as the union of what each type declares.
  `test:unit` 140 passed, `typecheck` clean, `build` emitted `dist/utilities.js`, `audit` 23 targets.
- [x] **T2 — Numeric utilities.** `stepForNumber`, `stepForInteger`, `numberAnswerFrom`, with the
  corpus evidence for each rule in the doc comments. Route: bounded writer.
  Evidence: 20 cases. `stepForInteger` honours a `multipleOf` of `2` where the expression it
  replaces, `Number.isInteger(1 / multipleOf)`, did not — the old control stepped by one for a field
  declaring two, which is the case the corpus accepts. That was a live defect in the example, found by
  moving the rule rather than by reading it.
- [x] **T3 — Text, textarea and boolean utilities.** `textAnswerFrom` and `checkedFrom`, documented
  as the non-inventing answers they are. Route: bounded writer.
  Evidence: the corpus turned out not to decide whether the core anchors `pattern` — its only two
  cases either match `^[a-z]+$` in full or contain no part of it, so both hypotheses produce the same
  outcome — so there is no `pattern` utility, and the omission is documented where a reader would
  come to "fix" it.
- [x] **T4 — Choice utilities.** The list↔scalar translation, and a sentinel that is checked against
  the options it has to survive. Route: bounded writer.
  Evidence: `choiceEmptyValue` generates a value absent from the field's own options and is stable
  across calls, which the hardcoded `"__colander_no_answer__"` was not. No defensive
  `choiceAnswersFrom(value: unknown)`: `choice-allow-multiple-single-string` shows the core reporting
  a scalar where a list was expected, and any such reader would convert that report into a value the
  core accepts.
- [x] **T5 — Temporal utilities.** The three wire formats, the round-trip guards, and the
  date+time composition rules, moved out of the example with their coverage. Route: bounded writer.
  Evidence: 31 cases. The move surfaced a real contract mismatch, resolved by the user as "read
  tolerantly, write strictly"; see finding 1.
- [x] **T6 — The registry.** `typeUtilities`, keyed by type with a conditional member type, and the
  `utilities` barrel. Last of the compiler's own units because it names all five families.
  Route: bounded writer.
  Evidence: `TypeUtilities` is a mapped type over `MaterializableFieldType` with no hand-written union
  of the nine names in the file. Exhaustiveness was proven, not asserted: deleting the `time` entry
  produces `error TS1360 … Property 'time' is missing … but required in type 'TypeUtilities'`.
  `text` and `textarea` are two entries rather than one object, so an entry cannot claim the wrong
  type.
- [x] **T7 — Migrate the react-app controls.** All nine controls consume the registry; `shared.tsx`
  keeps only `common`; the local `stepFor`, `reportNumber` and the local temporal module are gone.
  Route: bounded writer. Trigger: 2+ non-trivial files.
  Evidence: 150 lines left `shared.tsx` and it now holds one function. A source-level drift guard
  (`controls-use-utilities.test.ts`, 4 cases) asserts every control imports the utilities entry
  point, names `typeUtilities`, and declares none of the twelve retired names.
- [x] **T8 — Close the package.** Compiler README, root README table row if needed, `pnpm run
  check` and `pnpm run test` across the workspace, and the generated tree held to the mapping.
  Route: bounded writer.
  Evidence: the README gained a section per the design above; two pre-existing duplicated headings
  were fixed. The root `README.md` package table is per package, not per published surface, so it
  needed no change. The T8 writer found that the root re-exported only part of the new surface, which
  the entry-point test at the time could not see; both are fixed and the guard was proven by removing
  a name and watching it fail.

## Decisions

- Utilities live in the compiler, not in `@ailura/colander-client`. The client's table is a
  transcription of the core and is deliberately silent about markup and derivation
  (`semantics.ts:6-23`); adding derivation data there would make the client restate the core's
  intent, which is the one thing it exists not to do.
- The registry is keyed by type and its member type is a conditional on that type, so
  `typeUtilities.number.step` and `typeUtilities.integer.step` are different functions with
  different parameter types, and adding a tenth materializable type to the core's table fails this
  package's build.
- Family modules, not one flat file. Nine types' derivations in one module is what made the app's
  `shared.tsx` the place every per-type decision leaked into.
- The temporal code is moved, not rewritten. The round-trip guards encode real defects in
  `new Date(year, month, day)`; re-deriving them would be a regression risk bought for nothing.
- No utility is added for a pure rename. `minimum` → `min` is the consumer's markup, and
  `controlPropsFor` already forwards the name.
- Read tolerantly, write strictly, for the temporal answers. The parsers accept every shape the
  corpus proves the core accepts or emits, keeping the seconds and the offset in the value they
  return; the formatters keep writing `YYYY-MM-DD`, `HH:mm` and `YYYY-MM-DDTHH:mm`, because a widget
  edits wall-clock minutes. The cost of that choice is written into the two formatters that can drop
  precision and pinned by tests, rather than left for a reader to discover.
- `Z` and `+00:00` are not distinguishable in the model: both are an offset of `0`, and a spelling
  flag would be a fact about a string rather than about the instant. A non-zero offset is not in the
  model at all, because nothing in the repository proves one exists.
- `date`/`time`/`datetime` and `boolean` declare no property beyond the shell's two, so their
  utilities take no constraints parameter. An empty constraints type would let a caller pass anything
  and mean nothing by it.

## Findings

Three things this work found that it did not fix, each outside the authorized scope and each
recorded here rather than left in a diff.

1. **The core's temporal answers are wider than the three formats anything read.** `validate.json`
   `date-normalization` normalises `2024-1-5` to `2024-01-05`, `time-normalization` normalises
   `9:5:3` to `09:05:03` — the core carries seconds — and `datetime-normalization` turns
   `2024-01-05T10:00:00Z` into `2024-01-05T10:00:00.0000000+00:00`. The example's three strict
   patterns matched none of them, so a control handed an answer the core itself produced rendered
   empty. Handled for this feature by the read/write decision above. What it does not handle: a
   `time` read as `09:05:03` is written back as `09:05`, and a `datetime` read with an offset is
   written back without it, so a form that round-trips a server-normalised answer through a control
   still loses that precision. Fixing that needs a wire representation that can carry seconds and an
   offset, which is a larger decision than this feature was authorized to make.
2. **`packages/colander-browser` does not drop a panicked core.** `client.ts` `invoke` calls
   `forget(pending)` with the promise it awaited, but `load()` is an `async` function, so what it
   hands back is a wrapper promise and never the cached one; `forget`'s identity check therefore
   never matches and the trapped core stays cached for the life of the transport. Two of its own
   tests are red on the base for exactly this — `web-client.test.ts` "drops a panicked core without
   dropping a later recovered core" and "invalidates the cached core for a structural neutral
   panic" — and the react-app's `wasm-colander-transport.test.ts` "does not cache a core after a real
   panic" is the same defect seen from the consumer. Not fixed here: it is another package's, and the
   one-line fix changes a lifecycle contract someone should own.
3. **The example's `check` script cannot run.** `.gitignore` ignores `examples/` by a documented
   decision, and `vp fmt` discovers its targets through git, so `pnpm run check` in the react-app
   stops with "Expected at least one target file". Formatting was verified by naming the files
   explicitly. Also on the base, and also not this feature's.

## Verification

Green:

- `pnpm --filter @ailura/colander-compiler run test:unit` — 17 files, 257 tests passed.
- `pnpm --filter @ailura/colander-compiler run typecheck` — clean.
- `pnpm --filter @ailura/colander-compiler run fmt:check` — clean.
- `pnpm --filter @ailura/colander-compiler run build` — clean, `dist/utilities/` emitted.
- `pnpm --filter @ailura/colander-compiler run audit` — 23 published targets audited.
- react-app `generate`, `check:generated` and `build` — clean. `tsc -b` passing is the type-level
  evidence that every utility is called with the type's declared properties named explicitly and that
  the registry's conditional member type type-checks at all nine call sites.
- react-app `test` — 56 of 57, the single failure being finding 2, which is in another package and red
  on the base.
- The entry-point test proves `utilities.ts` reaches no Node built-in, and that the root re-exports
  the whole surface rather than part of it.

Red, and not this feature's:

- `pnpm --filter @ailura/colander-compiler run lint` — about 1600 diagnostics on the base, spread
  across pre-existing sources (`src/plugin.ts`, `src/check.ts`, `src/plan.ts`, `src/runtime.ts`) and
  every test file in the package. The new modules sit at the same density as the code beside them.
  Making that gate usable is a separate decision about the lint configuration.
- The react-app's own `check`, for finding 3.
- `packages/colander-browser`'s own suite, for finding 2.


## Evidence

### T1

- Three pre-existing failures in the compiler suite were red before T1 and had to be fixed for its
  own tests to be trustworthy. All three are recorded here rather than buried in a diff:
  - `plan.test.ts` "names every key it does not recognise" expected the unrecognised keys in one
    order and `requireKnownTypeNames` emitted insertion order. `plan.ts` now sorts them, and the
    test's expectation and its key order were corrected together: a report a reader cannot predict
    is a report they cannot match against the object that produced it.
  - `plan.test.ts` "reads an explicitly undefined component as unmapped" does not compile under
    `exactOptionalPropertyTypes`, because a `Partial<Record<…, ComponentSource>>` does not admit an
    explicit `undefined`. The test now widens that one object, which is also the honest statement of
    what the case is for: a config loader can hand a mapping an explicit `undefined`.
  - `entrypoints.test.ts` `graphOf` indexed `match[1]` without a guard under
    `noUncheckedIndexedAccess`.
- None of the three is in the utilities surface; they were found because T1 had to run the suite.
