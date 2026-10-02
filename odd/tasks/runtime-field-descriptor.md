# Runtime field descriptor and error grouping

## Status

Accepted. Destination decided with the user: `@ailura/colander-client`.

## Objective

Close the runtime half of the gap that `colander-bindings.md` identified, without creating a
new package. Add `describeField` — a per-field control descriptor built from a `LeafNode`, a
`RuleState` and that field's errors — and `groupErrorsByField`, which maps a validated response's
errors onto field ids. Together they answer "render this with that, in this state, with these
errors", which today every renderer re-derives for itself.

## Why this replaces `colander-bindings.md`

That document was written before two things existed, and both change it.

**1. The semantic table already exists.** `component-compiler.md` T1 added
`packages/colander-client/src/semantics.ts`: `SEMANTIC_TYPE_DESCRIPTORS` with, per type, the wire
properties it carries (always including `title` and `description`), its `value` shape, whether it is
`materializable`, and `shapeFromProperty`. It is the core's own authority on per-type semantics and
is exported from the package root and from `./semantics`. `bindings` T2 (`ControlRecipe`,
`ControlKind`, `createRegistry`) and T3 (widget-to-kind resolution) both re-derive what this table
already states, and they introduce a second answer to "which control is this field": the compiler
keys by `type`, bindings would have keyed by `widget`. There is one vocabulary, and this document
uses it.

**2. It cannot go in the compiler.** `@ailura/colander-compiler` is build-time and Node-only: it
reads the table, runs a pure planner, and writes source files. A descriptor's `value`, `state` and
`errors` exist only while a person is filling a form in a browser, against a `RuleState` and a
validated response. A runtime module in that package would make every renderer import a Node
build-time package to read props. The compiler **consumes** this work; it does not own it.

`colander-bindings.md` is therefore cancelled rather than rewritten. Its three surviving
requirements are T4, T5 and T6 below.

## What this adds that nothing else has

- `value`, resolved per field instance and code-keyed.
- `state`: the effective flags after rules, with container inheritance already applied by
  `createRuleState`, plus read-only for calculated fields.
- `errors`: grouped onto field ids, with the two non-field path shapes preserved.
- `options`: normalized, with `selected` computed against the actual value.

All four are runtime. The compiler's generated controls are static per type. That is why this gap
existed at all.

## API

```ts
export interface FieldError {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface ControlOption {
  readonly value: string;
  readonly label: string;
  readonly selected: boolean;
}

export interface ControlConstraints {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly multipleOf?: number;
  readonly decimalPlaces?: number;
}

export interface ControlState {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly required: boolean;
  readonly readOnly: boolean;
}

export interface ControlDescriptor {
  readonly id: string;
  readonly code: string;
  readonly pointer: string;
  readonly type: string;
  readonly label: string;
  readonly description?: string;
  readonly value: unknown;
  readonly options: readonly ControlOption[];
  readonly constraints: ControlConstraints;
  readonly state: ControlState;
  readonly errors: readonly FieldError[];
  readonly aria: { readonly describedBy?: string; readonly invalid: boolean };
}

export function describeField(
  node: LeafNode,
  state: RuleState,
  errors?: readonly FieldError[],
): ControlDescriptor;

export function groupErrorsByField(
  definition: FormDefinition,
  errors: readonly ResponseError[],
): Readonly<Record<string, readonly FieldError[]>>;
```

### Decisions the implementation must honour

- **Constraint keys keep the core's wire names.** `minimum` and `maximum`, not `min` and `max`. The
  compiler's constraint is that the core's `Field` keys stay the wire contract; the descriptor
  describes those keys and does not rename them.
- **`type` is `string`, not a closed union.** `FieldType` is `ColanderFieldType | (string & {})`, and
  `semanticDescriptorFor` returns `null` for a type outside the core vocabulary.
- **The descriptor is total.** `describeField` never throws for a field it does not understand. A
  type with no semantic descriptor yields a descriptor with empty `constraints`, empty `options` and
  the raw `value`. A binding that throws on an unrecognized field is worse than useless: the core
  does not validate `widget`, and a compiled form is only as trustworthy as the vocabulary the
  caller compiled it against. Refusing to describe is not an option.
- **`readOnly` is true for a calculated field.** `definition.calculatedCodes` is code-keyed. The
  core owns those values and a renderer must not write them back.
- **Every effective flag falls back to the node baseline.** `RuleState`'s maps are keyed by field id;
  a field absent from a map takes `node.required` / `node.readOnly`, and `visible` / `enabled`
  default to `true`.
- **`required` follows the evaluation, not the schema baseline.** This is what `apply-rules` already
  computes; a field that a rule made not-required is not required.
- **A hidden field keeps its value.** `RuleState.values` deliberately retains hidden answers.
  `describeField` reports `visible: false` and does not clear anything.
- **Options are normalized for `choice` only**, with `label` defaulting to `value` when the
  document omits it, and `selected` computed against the value: a `string-or-string-list` value
  selects by membership, a `string` selects by equality. Every other type gets `[]`.
- **`aria.invalid` is `errors.length > 0`.** `aria.describedBy` is the field id when a description
  exists, otherwise absent — it points at nothing the renderer has not been told to render.
- **`groupErrorsByField` drops nothing.** An error resolving to `kind: "field"` keys by its id. An
  `answers` error with a resolvable id keys by that id too, because the id is the field. Every
  remaining error — an unknown answer key, a `/rules/validations` failure, a path that resolves to
  nothing — lands under an exported reserved key. A cross-field error that silently disappears is
  how a form looks valid when it is not.

### Reserved keys

```ts
export const ANSWERS_ERROR_KEY = "__answers__";
export const RULES_ERROR_KEY = "__rules__";
export const UNRESOLVED_ERROR_KEY = "__unresolved__";
```

Exported by name so a renderer can enumerate them instead of guessing at string literals.

## Non-goals

- **No rendering.** No JSX, no component, no framework dependency, no DOM.
- **No re-implementation.** `FormDefinition`, `createRuleState` and `resolveFieldForPath` are
  dependencies, not reimplementations.
- **No `group` / `repeater` in v1.** `describeField` takes a `LeafNode`; a container has no answer
  of its own to describe.
- **No `widget` axis.** The core does not validate it, the compiler does not read it, and the
  semantic table is the vocabulary. A renderer that wants a component library chooses one from the
  type.
- **No compiler change in this document.** Wiring the generated controls to consume the descriptor is
  a follow-up that touches `examples/react-app`, which is out of scope here.
- **No re-validation of the type.** `isKnownFieldType` guards the hand-authored path and stays
  where it is.

## Acceptance

- `describeField` produces a descriptor for a leaf node with no errors argument.
- A field absent from every `RuleState` map reports `visible` and `enabled` as `true` and takes
  `required` / `readOnly` from the node.
- A calculated field reports `readOnly: true` regardless of the evaluation.
- A hidden field reports `visible: false` and keeps its value.
- A single-select `choice` marks exactly the matching option `selected`; an `allowMultiple` choice
  marks every member of the list.
- An option with no label falls back to its value.
- A type outside the core vocabulary still produces a descriptor, with empty `constraints` and
  `options`, and does not throw.
- `groupErrorsByField` keys field errors by field id and preserves `/answers/<unknown-key>`,
  `/rules/validations`, and unresolvable paths under the three reserved keys.
- Every test runs without a DOM, against a real compiled form fixture.
- The package gains no runtime dependency.

## Work units

Test-first: each unit states its expected failure before its implementation, and no unit closes with
a red suite.

- [ ] **T1 — Package surface.** `src/describe.ts` with the exported types, the three reserved key
  constants, and the package `exports` subpath. RED: a test importing from the subpath fails to
  resolve. Route: bounded writer.
- [ ] **T2 — `groupErrorsByField`.** Map every `ResponseError` through `resolveFieldForPath` and key
  it by field id or reserved key, preserving every entry. RED: the grouping tests fail against the
  stub. Route: bounded writer.
- [ ] **T3 — `describeField`: identity, label, value, state.** `id`, `code`, `pointer`, `type`,
  `label`, `description`, `value`, and the effective `state` with node fallbacks and the calculated
  read-only rule. Route: bounded writer.
- [ ] **T4 — `describeField`: options, constraints, errors, aria.** `choice` option normalization
  with `selected`, constraints filtered through `semanticDescriptorFor`, the field's errors, and
  the `aria` pair. RED before GREEN, and the totality case is a first-class test, not an afterthought.
  Route: bounded writer.
- [ ] **T5 — Exports and README.** Root exports plus the `./describe` subpath in `package.json`, and
  a README section stating what the descriptor is, what it deliberately omits, and how a renderer
  consumes it. Route: bounded writer.
- [ ] **T6 — Verification.** `test:unit`, `typecheck`, and `check` green in the package. Route:
  verification worker.

## Verification commands

```
pnpm --filter @ailura/colander-client run test:unit
pnpm --filter @ailura/colander-client run typecheck
pnpm --filter @ailura/colander-client run check
```

## Authorized scope

- `packages/colander-client/src/describe.ts`
- `packages/colander-client/src/index.ts`
- `packages/colander-client/package.json` (exports subpath only)
- `packages/colander-client/test/describe.test.ts`
- `packages/colander-client/README.md`
- This feature document.

Everything else in the worktree, including `packages/colander-compiler` and every example, is
untouched.

## Commits

None. No commit has been requested for any of this repository's current work.
