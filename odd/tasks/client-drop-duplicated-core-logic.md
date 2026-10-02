# Drop client-side re-derivations of core invariants

## Objective

Remove the domain logic in `@ailura/colander-client` that re-derives a
decision the Colander core already owns, so the client becomes an adapter rather
than a second partial implementation. Three work units are pure deletion; two
further items are blocked on a product decision and are explicitly out of scope.

## Problem

`packages/colander-client` re-implements four core invariants in TypeScript. The
core is the published contract; a second implementation of the same rule is a
drift risk, and in three cases the two implementations already disagree.

- **Answer coercion** (`coerceScalar`/`coerceValue`/`coerceAnswers`) converts
  `"12"` to `12` before the request leaves the client. The core's conversion is
  strict (`src/validate/conversion.rs`): a string for a `number` field is
  `INVALID_TYPE`. Client coercion therefore makes the core's conversion
  unreachable, and it uses JS `Number()`, so `V-11` ("the core never rounds a
  client's exact integer away in silence") is violated one layer earlier than
  the core can defend.
- **Calculated-answer stripping** (`withoutCalculatedAnswers`) removes
  calculated codes from the submitted answers. `V-8` says a stale calculated
  value is reported as `CALCULATED_VALUE_MISMATCH`; deleting the answer client
  side makes that error impossible to observe.
- **Layout-derived `hidden`** (`hiddenById` from `layout[].hidden`) treats layout
  nodes as a source of hidden-ness. The core reads only `ui.fields[id].hidden`
  (`src/rules/evaluate.rs`, `is_ui_hidden`). A form that hides a field via a
  layout node is "visible" to the core and "hidden" to the renderer.
- **The twelve field types** (`COLANDER_FIELD_TYPES`, `isKnownFieldType`)
  restate `D-2` and re-validate documents the core already rejected. `E-4`
  makes an invalid document a failure envelope, so an unknown type cannot reach
  a consumer that holds a core-validated document.

The coercion decision is recorded in `odd/tasks/colander-transport-package.md`
(T2, "answer coercion") and the object-first boundary in T5. This change
reverses the coercion decision only, on the grounds that it contradicts
`V-2`/`V-8`/`V-11` and the package's own README rule that adapters must not
re-serialize or re-interpret core-bound documents.

## Scope

- Delete `coerceAnswers`, `coerceScalar`, and `coerceValue`; forward the
  caller's values verbatim in `createEvaluateRulesRequest` and
  `createValidateResponseRequest`.
- Delete `withoutCalculatedAnswers` and its call site.
- Drop the layout branch of `hiddenById`; keep hidden-ness sourced from
  `ui.fields` only, matching the core.
- Delete the runtime field-type guard (`isKnownFieldType`, `KNOWN_FIELD_TYPES`)
  and the `unsupported` branch of `buildNode` that consumes it. The compile-time
  `ColanderFieldType` union stays as a type-only mirror of `D-2`.
- Delete the runtime enumeration of core error kinds from the client package
  and keep only the transport-specific categories.
- Delete `AnswerShape`, `answerShapeByCode`, `collectAnswerShapes`,
  `buildRepeaterShape`, and `leafShape`; they existed only to drive coercion.
- Update the tests and the React example that assert the removed surface.

## Out of scope (blocked, not decided)

- **Container inheritance of `visibility`/`enabled`** in `apply-rules.ts`. The
  core evaluates visibility per field with no propagation
  (`src/rules/evaluate.rs:127-128`), so this is an added behaviour, not a
  duplicate. Removing it changes what a user sees for a hidden group with
  visible children. That is a product decision.
- **Derived `readOnly`** (`baseReadOnly || parentReadOnly || !enabled`). The
  core returns `visibility`/`enabled`/`required` (`E-2`) and no `readOnly` map,
  so the field cannot simply be deleted without losing calculated-field
  editability. It needs either a product decision or a core change.
- **`resolveFieldForPath`**. A real consumer need that re-implements `V-7`; it
  survives this change and is a later candidate for a core operation.
- **`stringifyDocument` in `createCompileRequest`.** Still `JSON.stringify`s the
  documents, against the README rule. The fix is an API decision about where
  the JSON text enters the client, not a deletion.
- **A core-side field index** (`colander_describe_form`). Not required for this
  change; the remaining walk in `createFormDefinition` is presentation.

## Constraints

- The project is unpublished, so the removals are breaking changes with no
  external consumer. The in-repo React example and `poc/` must still pass.
- No change to the core, to the ABI, to `SPEC.md`, or to the frozen vectors.
- The transport still forwards every `...Json` field as text. This change removes
  interpretation, not serialization.
- Hidden values stay in the submitted answers; a hidden answer is not an error.
- Technical artifacts and comments remain in English.

## Work units

- [x] **T1 — Forward answers without coercion.** Deleted `withoutCalculatedAnswers` and
  the coercion call in `createValidateResponseRequest`; deleted
  `coerceAnswers`/`coerceScalar`/`coerceValue` and the `AnswerShape` machinery
  from `createFormDefinition`; `createEvaluateRulesRequest` now forwards the
  caller's values. `form-definition.ts` went from 832 to 727 lines and the
  client suite is 44/44.
- [x] **T2 — Source hidden-ness from `ui.fields` only.** Deleted the layout
  branch of `hiddenById`; the single source now matches the core and the
  sibling .NET binding, which documents the same rule.
- [x] **T3 — Drop the duplicated vocabularies.** Deleted the runtime
  enumeration of core error kinds and made the category check structural.
  `isKnownFieldType` was **kept and re-scoped**: removing it made a
  hand-authored field with an unknown type render as a leaf instead of being
  reported in `unsupported`, which the existing test caught. It now guards only
  the object-first authoring path and never fires for a compiled document.
- [ ] **T4 — Update the consumers and the frozen expectations.** Blocked. The
  client and its own tests are updated, but the React example now fails one
  test because the change exposes a **core** defect; see the blocker below.

## Blocker found while verifying T4

Forwarding calculated answers made a latent core defect observable. Verified
empirically against the packaged WASM (`libcolander.wasm` 0.1.0, ABI v1), with a
minimal two-field form and with the React example's household sample:

- Submitting a calculated field's **own** value in `Complete` mode returns
  `CALCULATED_VALUE_MISMATCH` at the field's path. The correct value (`6`),
  the wrong value (`7`), and the double spelling (`6.0`) all fail identically.
- The same answers in `Draft` mode are accepted.
- Omitting the calculated answer is accepted in both modes.
- The declared field type (`integer` or `number`), `readOnly`, and
  `multipleOf` make no difference.
- BMI passes only because its `multipleOf: 0.01` rounds the calculated value to
  the same two decimals the sample submits.

The single frozen vector for this code (`calculated-mismatch-complete`) submits a
**wrong** value (`bmi: 1.0` against a calculated `22.857…`), so the
correct-value case is untested in `tests/golden/vectors/validate.json`.

The comparison lives in `src/validate/calculated.rs:43-55` and delegates to
`Val::values_equal` (`src/rules/value.rs:130-151`), whose `Int`/`Double` arms
both look correct on inspection; the defect is not yet root-caused in Rust.

This plausibly explains why the client stripped calculated answers in the first
place: the workaround hid a core defect rather than working around a contract.

## Acceptance criteria

- No `coerce` symbol and no `answerShapeByCode` remains in any package source.
- `createValidateResponseRequest` submits the caller's values, including
  calculated ones, without filtering or converting.
- Hidden-ness in the client definition matches the core: `ui.fields[id].hidden`
  only.
- `@ailura/colander-client` (44/44), `@ailura/colander` (29/29), and
  `@ailura/colander-browser` (10/10) typecheck and pass.
- The React example is **not** green: one test fails on the core defect above.
  This is the open decision, not a completed task.
- The core, the ABI, `SPEC.md`, and `tests/golden/vectors/*.json` are untouched.

## Evidence

- `src/validate/conversion.rs` — strict per-type conversion, `INVALID_TYPE`.
- `src/rules/evaluate.rs:127-128,156-165` — per-field visibility, `ui.fields`
  only, no container propagation.
- `SPEC.md` `V-2`, `V-8`, `V-11`, `E-4`, `D-2` — the clauses this restores.
- `colander-dotnet/src/AiluraCollective.Colander/Contracts.cs:174` — the
  sibling .NET binding documents "Only `fields.<id>.hidden` is read" and its
  `RuleEvaluation` has no `ReadOnly` map, independently confirming T2 and
  showing that the derived `readOnly` has no counterpart in the reference
  binding.
- Commits: none. The working tree was already dirty with the whole monorepo
  untracked on `feat/nest-colander-example`, so a coherent work-unit commit is
  not possible without first committing that restructure.
