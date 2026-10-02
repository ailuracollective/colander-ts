# T4 editor contract map

Read-only mapping of the control contract registry, verified against the source.
This is the table the visual editor's inspector is built from. Anything the editor
cannot express is a decision that has to be made deliberately, not discovered later.

## What the core materializes

Nine leaf types, derived not hand-listed:
`SEMANTIC_TYPE_DESCRIPTORS.filter((d) => d.materializable)` —
`text`, `textarea`, `number`, `integer`, `boolean`, `date`, `datetime`, `time`,
`choice`.

Three container types are **not** materializable: `group`, `repeater`,
`component-ref`. `defineControl` throws at runtime for them; only the tree walk
draws them. Their `value: "string"` in the descriptor table is a placeholder to
make the descriptor total — it is not an answer shape.

So the palette is exactly 9 + 3 = the whole of `COLANDER_FIELD_TYPES`. There is
no twelfth type.

## Inspector table

Common to every row: `title` (the display text), `description`, `required`,
`readOnly`; plus `options`, which reaches **every** control and is empty for
every type but `choice`.

| type | extra properties to edit | answer shape |
|---|---|---|
| `text` | `minLength`, `maxLength`, `pattern` | `string`; empty reports `""`, never `null` |
| `textarea` | `minLength`, `maxLength` | `string`; same rule |
| `number` | `minimum`, `maximum`, `multipleOf`, `decimalPlaces` | `number \| null`; empty → `null` |
| `integer` | `minimum`, `maximum`, `multipleOf` | `number \| null`; empty → `null`; **not rounded by the control** |
| `boolean` | none | `boolean`, never `null` |
| `date` | none | `string` `YYYY-MM-DD`; cleared → `""` |
| `time` | none | `string` `HH:mm`; cleared → `""` |
| `datetime` | none | `string` `YYYY-MM-DDTHH:mm`; cleared → `""`; a time with no day → `null` |
| `choice` | `allowMultiple` + the `options` list `{ value, label? }` | **depends on `allowMultiple`**: a scalar `string \| null` for a single-select, `readonly string[]` for a multiple one. This is the only answer shape in the system that is not derivable from the type, which is why the contract is a union discriminated on `allowMultiple` and not a per-type mapping. |

Containers, for the palette and the tree:

| type | to edit | answer |
|---|---|---|
| `group` | `title`, `description`, children | none |
| `component-ref` | `title`, `description`, children, and which component it names | none |
| `repeater` | `title`, `description`, `minItems`, `maxItems`, children | array of per-row answer objects keyed by child `code` |

The full universe of wire keys is `FIELD_PROPERTY_KEYS`: `minLength`, `maxLength`,
`pattern`, `minimum`, `maximum`, `multipleOf`, `decimalPlaces`, `allowMultiple`,
`minItems`, `maxItems`, `title`, `description`. `title` and `description` are
shell-owned (`SHELL_OWNED_PROPERTIES`) so a field can never draw its label twice.
`minItems`/`maxItems` belong to `repeater` and reach no control.

## Three facts that change the editor's design

1. **`disabled`, `readOnly` and `required` are rule-engine conclusions, not
   document fields.** They come from `createRuleState`/`applyEvaluation`, so a
   control cannot re-derive them. The editor sets the document's own
   `required`; the runtime shows the engine's verdict.
2. **`title` and `description` never reach the control.** They go to the shell
   through the `{control}` slot. The two prop bags are disjoint by construction.
3. **`allowMultiple` decides the answer shape, and the core is strict about it.**
   `/home/lives/colander/src/validate/conversion.rs` requires `Json::as_str`
   from `convert_single_choice` and `Json::Array` from `convert_multi_choice`, so
   a single-select answered with a list is a type error — *Field '…' must be a
   choice value.* The TypeScript contract used to say a choice always answers with
   a list, and the app's control followed it, which is how answering an ordinary
   dropdown produced a false validation error. That is fixed: the contract is a
   union discriminated on the literal `allowMultiple`, and the control draws a real
   checkbox multi-select when the flag is set. The **inbound** value stays the
   wide `string | null | readonly string[]` in both branches, deliberately,
   because a document that sets `allowMultiple` against a stored answer that
   disagrees is a case a control must survive; narrowing it would force a cast or
   a branch on a fact the control cannot establish.
4. **A `choice` with no options, or with an empty `options` array, cannot be
   answered.** `convert_choice` returns `invalid_schema_error` — *Choice field
   '…' is missing options.* It is a conversion error and not a schema one: the
   document still **compiles and still publishes**, and a choice with no options
   that nobody answers validates clean. So the trap only appears when somebody
   tries to answer it, which means the editor is the only place that can say so —
   the core's `schemaCheck` cannot, because nothing is wrong with the document
   until it is answered. A field that compiles, publishes and cannot be answered
   is the worst of the three, and an authoring tool has to name it.

## How the editor is built, in three pieces

The editor is one feature and it ships as one feature. It is implemented in three
pieces because a single pass over a canvas, an inspector, a drag interaction and
a rule builder is how this work has already failed twice on timeout.

- **T4a — the document model, the tree, the palette, the inspector.** The model
  the editor edits, a tree it renders, a palette of the twelve types, and an
  inspector that can edit every property in the table above. No drag and drop
  yet: fields are added, removed and reordered through explicit controls.
- **T4b — drag and drop.** Reordering and reparenting over that same tree, with
  the rules about what may be dropped where.
- **T4c — the rule builder.** `visibleWhen`, `enabledWhen`, `requiredWhen` and
  `calculate` — which is exactly what the client's `FieldRules` carries, no more
  and no less. An earlier draft of this document listed a `readOnlyWhen` as well;
  that was my error, `FieldRules` in `packages/colander-client/src/types.ts` has
  four keys and no fifth.

  **The operator vocabulary is not in the type system.** `Expression` is
  `{ ref } | { lit } | { op: string, args? }` — `op` is a plain `string`, so
  nothing in TypeScript enumerates what the core accepts. The ops visible in this
  repo's corpora are `eq`, `neq`, `gt`, `lt`, `add`, `sub`, `mul`, `div`, `pow`,
  `and`, `or`, `not`, `empty`, `coalesce` — and that is evidence, not a
  declaration. The Rust core is not in this tree, only its built artifact, so
  there is nothing to derive an exhaustive list from. The builder therefore
  offers that observed set, **keeps a free-text operator field** so an operator it
  has never heard of stays expressible, and never claims completeness. The core
  disposes: an unknown operator is refused at compile, which the editor already
  surfaces.

## Three traps in an editor over a schema it does not own

1. **The editor serialises exactly once.** Parsing the stored document in the
   browser and saving a re-serialisation is the normal thing for a form editor to
   do, and here it is the one thing it must not do *silently*. The rule in this
   repo is that the text stored is the text the core hashed. So: parse on load,
   serialise once on save, send that exact string, and hash and validate that
   same string. Never "store the parsed document and let the backend
   re-serialise".
2. **The editor must not drop what it does not understand.** The document model
   has more keys than the inspector edits. A visual editor that rebuilds the
   document from only the fields it knows will silently delete the rest. The
   model has to round-trip unknown keys untouched, and a test has to prove it by
   loading a document with keys the editor never displays and saving it back
   byte-identical.
3. **The palette may not invent a type.** Twelve types, three of them containers
   that only the tree draws. `component-ref` names a component that has to exist,
   and a `repeater`'s children are answerable fields, not containers.

**The drop rule below was reversed by decision, and the reversal is the lesson.**
It used to read "a drop target that is not legal for the dragged type is a bug, not
a warning" — written from the rule that a refusal must never be swallowed. That
was half a rule. A product that *aims* at a position the model always refuses
raises that error constantly, because a leaf's box is mostly its own controls and
the middle band is the dominant drop position. The user found it by dragging.

The rule now: **the editor must not aim at a position the model will always
refuse.** A drop resolves by climbing — start at the hovered node, move up while it
cannot receive the dragged node, and at the first ancestor that can, insert
immediately below the deepest node that could not. "Downward" is what falling out
of the climb means; the rule never inserts above the pointer and never invents a
position the model would refuse. It has no per-type cases.

The boundary is unchanged even so: the drag layer **asks and does not know.** It
calls the model's predicate for the hovered node and for each ancestor as it
climbs, and it holds no rule of its own. A refusal that is still *reachable* — the
climb running out of ancestors — is announced in the model's words. A refusal the
climb already resolved is never reached, and that is the point.

## The palette, the tree, and the shell

- The tree renders a group or a component as its legend plus its children, and
  a field through the existing `controls.shell` so a field's label, description
  and errors draw exactly as they do at runtime.
- The editor is a separate route from the runtime. A form being authored is a
  draft, and a draft can be invalid, so it must not pretend to be answerable.
- Live validation reuses the `schemaCheck` the API already returns on a version
  read, which the definitions resource builds from `compile`. `validateSchema` is
  not an option: with no `schemas` map the core rejects every document.

## Open points, unresolved in this area

- The `title → label` derivation and its fallback for a field with no title live
  in the client and were outside the mapping.
- Whether the core itself is lenient about `decimalPlaces: 0` or negative bounds
  is not stated anywhere in the contract layer; the compiler only consumes those
  defensively.
- The repeater row shape (`[{ childCode: answer }]`) is not part of the contract;
  it exists only in the runtime's raw-array handling.

## How the drag is verified, and the one thing it is not

Synthetic HTML5 drag events dispatched in a single task can never exercise this
code: `dragstart` sets React state that does not re-render until the task ends, so
the drop zone still reads "no drag in progress" and ignores everything after it.
With a tick between the events it works, and that is how the drag is verified:
`text, number, choice` becomes `choice, text, number` by a scripted drag.

Native mouse input cannot start a drag in this headless Chromium at all —
`Input.dispatchMouseEvent` produced zero drag events. So **a person grabbing the
handle with a mouse is the one thing no check here has confirmed.** Everything
else is covered: the address arithmetic by tests, the interaction by dispatched
events, the indicator by computed style.

The explicit controls are the accessible path by design. A drag-only editor is an
editor some people cannot use, and the up/down buttons are not legacy to be
removed once drag exists.
