# The choice answer shape, and what to do about it

A defect in the existing system, found by walking the responses API end to end.
Nothing in this feature introduced it, and no test could have found it: the unit
tests mock the core, and the corpus fixtures never answer a single-select choice.

## What is actually true

Three measurements, in the order they should be trusted.

**1. The frozen corpus is the authority.** `packages/colander/test/fixtures/contract-vectors/colander-0.1.0/validate.json`
carries a `patient.color` choice without `allowMultiple`, a `patient.tags` choice
with `allowMultiple: true`, and a `patient.noopts` choice with no options at all.
Its answer cases are:

| case | answer | field |
|---|---|---|
| `choice-invalid-value` | `"green"` | `patient.color`, single-select |
| `choice-missing-options` | `"x"` | `patient.noopts` |
| `choice-allow-multiple-array-answer` | `["a","b"]` | `patient.tags`, multiple |
| `choice-allow-multiple-single-string` | `"a"` | `patient.tags`, multiple |
| `choice-allow-multiple-invalid-member` | `["z"]` | `patient.tags`, multiple |

**No case anywhere in the corpus sends a list to a single-select choice.**

**2. The core's behaviour, measured.** Against the running core:

| answer for a single-select choice | result |
|---|---|
| `["standard"]` | `isValid: false` — *Field '…' must be a choice value.* |
| `"standard"` | `isValid: true` |
| `[]` | `isValid: true` |
| absent | `isValid: true` |

The empty list and the absent field are both fine, which is the tell: the core
treats "no answer" as valid and a one-element list as malformed, not as an answer
it understands.

**3. The TypeScript contract disagrees.** `ControlValue<"string-list">` is
`readonly string[]` and `choiceAnswerFrom` produces `[]` or `[selected]`, so
`examples/react-app/src/components/colander/choice.tsx` emits `onChange([next])`
unconditionally. That is a correct answer for `allowMultiple: true` and a
malformed one for a single-select.

## The shape of the problem

**The answer shape is per *type* in the contract, and per *configuration* on the
wire.** A single-select choice answers with a scalar; a multiple one answers with
a list. `allowMultiple` is a field property, not a type property, so
`MaterializableFieldType` can name the shape only by being wrong for one of the
two cases. That is the whole defect, and it is why neither "fix the control" nor
"fix the validator" is a one-liner.

It is also why the fix cannot be chosen by preference — and the first version of
this document got the second half of that wrong. It claimed the core "is already
lenient" and that the narrowness "is only on the single-select side". **That was
false, and it was based on reading corpus case *names* without reading what they
assert.** The Rust is decisive:

```rust
// src/validate/conversion.rs — convert_multi_choice
let Some(Json::Array(items)) = value else {
    return Err(type_error(field, "an array of choice values"));
};
// src/validate/conversion.rs — convert_single_choice
let Some(choice) = value.and_then(Json::as_str) else {
    return Err(type_error(field, "a choice value"));
};
```

Measured against the running core, on a form carrying both kinds of choice:

| answer | result |
|---|---|
| multiple ← `"a"` (scalar) | `false` — *must be an array of choice values* |
| multiple ← `["a","b"]` | `true` |
| single ← `"red"` | `true` |
| single ← `["red"]` | `false` — *must be a choice value* |
| single ← `["red","blue"]` | `false` |

**The core is strict and symmetric on purpose: a multiple choice takes a list, a
single-select takes a scalar.** The corpus case named
`choice-allow-multiple-single-string` asserts the *rejection*, not an acceptance.

So the core is right, the corpus is right, and the TypeScript contract is what
is wrong. That flips the recommendation, and it is the reason the next section is
rewritten rather than patched.

## The alternatives

### A. Make the core accept a one-element list for a single-select choice
**This changes a deliberate, symmetric design into an asymmetric one.** The core
would then accept three of four combinations (single←scalar, single←list-of-one,
multiple←list) and reject only multiple←scalar. It is defensible as leniency
toward a client that cannot know the difference, and it is a change to a
published crate whose corpus is digest-asserted, so it needs a version bump.

- **Cost:** none in TypeScript. No control, no contract, no consumer changes.
- **Blocker:** the Rust core **is not in this repository** — only its built
  artifact and the digest-asserted corpus. This is an upstream change wherever
  `colander` 0.1.0 is built, and it needs a version bump because the corpus is
  frozen against a digest.
- **Test:** two new corpus cases — a one-element list for a single-select that is
  valid, and a two-element list for a single-select that is not.

### B. Make the contract per-configuration in the compiler
`choiceAnswerFrom` grows an `allowMultiple` parameter, `ControlChange<"choice">`
becomes a union, and the generated choice control emits a scalar for a
single-select and a list for a multiple. The contract then says what the core
actually expects.

- **Cost:** a breaking change to the compiler's public surface — `host.ts`,
  `utilities/choice.ts`, the registry entry, and every consumer's control. The
  registry's exhaustiveness check means a new materialisable type still fails to
  compile, which is preserved.
- **Difficulty:** `ControlValue<V>` is keyed by *value kind*, so expressing
  "scalar or list depending on a field flag" needs a union at the choice site.
  The mapped-type discipline in the registry makes that awkward, not impossible.
- **Test:** the control contract tests in the compiler, plus a new case in the
  app's own choice control.

### C. Normalise at the boundary, as a marked shim
One function converts `[x]` to `x` for non-multiple choices before the core is
called, and maps back afterwards.

- **Cost:** small, local, and it works today without an upstream release.
- **Why it cannot be the whole answer:** it breaks the invariant this whole system
  is built on — *the bytes we store are the bytes the core validated*. The stored
  answers would differ from the submitted answers, which is precisely the class
  of defect the `unansweredValue` and content-hash work removed. Shipping it
  without a comment saying "remove me when the core accepts a list" would turn a
  visible bug into an invisible one.
- **Defensible** as a shim while A is upstreamed, and only then.

### D. Document it and let the editor warn
Leave the mismatch, document it, and have the editor warn when a single-select
choice is answered in a shape the core will reject.

- **Cost:** a user of the shipped runtime can still hit a false validation error
  on an ordinary action — answering a dropdown and pressing Validate. Not an
  acceptable resting state, and worth saying so plainly rather than shipping a
  warning about a bug that is still there.

## The recommendation, and the tension in it

**B is the fix, and A is the alternative to it.** The first version of this
document recommended the opposite, on the false premise that the core was already
lenient. With that removed, the ordering is forced: the core is digest-asserted,
symmetric, and correct for a wire contract; the TypeScript side is the one that
cannot express "scalar or list" because it keys the shape off the type rather
than off `allowMultiple`. Making the contract match is a change in one package
with no version bump. Making the core match is a change to a published crate and
to a frozen corpus, and it makes the contract *more* permissive about a shape the
core has no reason to accept.

**One caveat on B, stated honestly:** `ControlChange<"choice">` becomes a union,
`string | readonly string[]`, which is a breaking change to the compiler's
published surface. Every control, consumer and generated file that types a choice
answer has to be revisited. That is a real cost — but it is a cost paid to make a
published contract say what a digest-asserted core already does, and it is the
kind of break that is cheap now and expensive after the crate has consumers.

**The tension worth naming:** the correct fix is upstream and needs a core
release; the working fix is local and violates an invariant this system depends
on. If a release is not immediately available, C is the honest bridge and it must
be marked as a bridge. What is not honest is shipping C and describing it as the
fix.

The core's source **is** available in this environment, at `/home/lives/colander`
(crate `colander` 1.0.0, commit `c415d2e`), and the build supports pointing at a
sibling checkout or a git commit. So A is implementable here, and not merely
upstream in principle — it is a change to a published crate plus a corpus digest
plus a rebuilt artifact.

The product decision is which of these the project should carry.

## Outcome

**B was chosen and is implemented.** The core is unchanged; the TypeScript contract
now says what the digest-asserted core already said.

- `SemanticValueKind` gains `"string-or-string-list"`, which the `choice`
  descriptor declares, with a `shapeFromProperty: "allowMultiple"` so a control
  knows which field property decides its shape. `"string-list"` stays in the
  union: no descriptor claims it any more, but it remains a true statement about
  a shape and retiring a name the core never contradicted is a break this change
  did not need.
- The two directions are deliberately asymmetric, and the asymmetry is the
  decision:
  - **outbound** (`ControlChange`) is keyed on the field's configuration, so a
    single-select's `onChange` rejects a list at compile time and a multiple's
    rejects a scalar;
  - **inbound** (`ControlValue`) is `string | null | readonly string[]` in both
    branches, deliberately not narrowed, because a document that sets
    `allowMultiple` against a stored answer that disagrees is a real case a
    control must survive. Narrowing it would force a cast or a branch on a fact
    the control cannot establish.
- `choiceControlValue` narrows the union with a `typeof` branch and a `null`
  branch and needs no cast. **That is the thesis of this whole thread in one
  function:** a type that needed a cast was a type that was lying.
- The app's control became a real multi-select: a `Checkbox` per option when
  `allowMultiple` is set, reporting the full list; a `Select` reporting a scalar
  otherwise. The comment that said a multiple "degrades to a single pick" was
  true of the old widget and false of the contract, and is now rewritten.
- The registry's exhaustiveness is now checked three ways **in `src/`**, where
  `tsc -b` reads them: a per-key walk that fails on any `never` (walking
  one at a time, because a distributed conditional would absorb a `never` and look
  complete), a two-way key-identity check, and an unsatisfiable
  `@ts-expect-error` entry whose becoming valid would fail the build.

Proven against the running core, with the answers computed by the built
utilities rather than by hand:

| answers | result |
|---|---|
| what the utilities now emit | `isValid: true` |
| unanswered: `null` for single, `[]` for multiple | `isValid: true` |
| both absent | `isValid: true` |
| the old behaviour: single answered with a list | `false` — *must be a choice value* |
| the old behaviour: multiple answered with a scalar | `false` — *must be an array of choice values* |

The last two reproduce the shipped defect and the Rust error strings verbatim.

**Not demonstrated, and not claimed:** that a tenth materialisable type fails to
build. It would need a new entry in `COLANDER_FIELD_TYPES`, which was outside the
change's surface. The unsatisfiable-entry check is the honest substitute.

## Acceptance evidence