# Colander bindings: describe a form control, do not render it

## Objective

Add an intermediate package that turns a compiled form plus its rule state into **framework-free
control descriptors**: which control a field is, what props it takes, what state it is in, and
which errors belong to it. It does not render. React, Vue and Angular consume the same descriptors.

## Problem

The repository already owns the first two thirds of the problem and is missing the last one.

`@ailura/colander-client` is already renderer-neutral and already applies the rules:

- `createFormDefinitionFromDescribed` / `…FromCompiled` build a `FormDefinition`: a read-only index
  with `root: readonly FormNode[]`, the `codeById` / `idByCode` / `byPointer` / `pathById` maps,
  `labelById`, `hiddenById`, `calculatedCodes`, `staticReadOnlyById`, `parentIdById`.
- `createRuleState(definition, evaluation)` turns a `RuleEvaluation` into `{ values, visibility,
  enabled, required, readOnly }`, keyed by field id, with container inheritance resolved and
  calculated values carried as read-only.
- `resolveFieldForPath(definition, path)` already maps a `ResponseValidation.errors[].path` back to
  `{ id, code, label, pointer, kind }`, including the `/answers/<code>` and `/rules/validations`
  cases.

What is missing is the step from `FormNode` + `RuleState` to **"render this with that, in this state,
with these props"**. Today each consumer writes that itself, which means the rule wiring, the
option normalization, the constraint mapping and the accessibility attributes get re-derived, slightly
differently, per consumer.

## The constraint that shapes the design

The core does not validate the UI `widget` name. Measured against the vendored engine:

```text
text-input       -> compiled
MUI-TextField    -> compiled
made-up-widget   -> compiled
```

Any string survives `colander_compile` and travels verbatim into the canonical UI document. The
widget vocabulary is convention, and the only thing that can enforce it is the JSON Schema a caller
passes to `colander_validate_schema`. Three consequences:

- **The registry is total.** An unknown widget cannot be an error; a binding that throws on a typo in
  a form document is worse than useless. It resolves to a documented fallback.
- **`type` is the reliable axis and `widget` is a hint.** Resolution goes: widget → registry → else
  `type` → the type's default kind. The reverse would make an unvalidated string authoritative.
- **The vocabulary is small and closed.** Nine leaf widgets, mapped almost one to one from the twelve
  field types, plus `group` and `repeater` as containers. The registry surface is nine entries.

## v1 scope: the nine leaf controls

`text-input`, `textarea`, `number-input`, `integer-input`, `toggle`, `date-picker`,
`datetime-picker`, `time-picker`, `select`.

`group` and `repeater` are containers, not controls: they need layout, `itemTemplate` and add/remove
wiring, and they are the natural v2 once the leaf descriptor is proven against a real form. A v1
descriptor describes one leaf field, which is the unit a renderer actually consumes.

`component-ref` never reaches a renderer as a leaf: the core expands it during `compile`.

## Design

### The registry holds recipes, not components

A descriptor-only package cannot hold a component without taking a framework as a dependency, which
is the thing this package exists to avoid. So the registry maps a kind to a **`ControlRecipe`**: a
declarative description of the control's semantics.

```ts
type ControlKind =
  | "text-input" | "textarea" | "number-input" | "integer-input"
  | "toggle" | "date-picker" | "datetime-picker" | "time-picker" | "select";

interface ControlRecipe {
  readonly element: "input" | "select" | "textarea";
  readonly inputType?: string;          // "text" | "number" | "date" | …
  readonly value: "string" | "number" | "boolean" | "string[]";
  readonly multiple?: boolean;          // a choice with allowMultiple
}
```

`createRegistry()` returns the native HTML recipes, so the default works with zero configuration.
`createRegistry({ "text-input": myRecipe })` overrides entries. The **component library** override —
MUI, Naive, Ant — lives in the renderer package, which is the layer allowed to know about components.
That keeps "out of the box and overridable" true at both layers without the intermediate ever
importing React.

### The descriptor

```ts
interface ControlDescriptor {
  readonly kind: ControlKind;
  readonly recipe: ControlRecipe;
  readonly id: string;                 // field id: rules and UI key on it
  readonly code: string;               // answer key: values and calculatedValues key on it
  readonly pointer: string;            // JSON pointer, for errors and scroll-to
  readonly label: string;
  readonly description?: string;
  readonly value: unknown;             // code-keyed value
  readonly options: readonly { value: string; label: string; selected: boolean }[];
  readonly constraints: {
    minLength?: number; maxLength?: number; pattern?: string;
    min?: number; max?: number; multipleOf?: number; decimalPlaces?: number;
  };
  readonly state: { visible: boolean; enabled: boolean; required: boolean; readOnly: boolean };
  readonly errors: readonly { code: string; message: string }[];
  readonly aria: { describedBy?: string; invalid: boolean };
}
```

`state.readOnly` is true for a field the rules mark read-only **and** for every calculated field: the
core owns those values, so a renderer must not write them back. The transport already omits them.

### Inputs

```ts
describeField(node: LeafNode, state: RuleState, context: DescribeContext): ControlDescriptor
```

`DescribeContext` carries the `UiFieldEntry` for the field (`widget`, and any presentation extras the
caller wants to pass through) and the errors already grouped by field id. `FormDefinition` deliberately
models only `hidden` and `label` from the UI schema, so `widget` and the rest are read here rather
than widening the headless index.

### Errors

`groupErrorsByField(definition, response)` maps every `ResponseValidation.errors[]` entry through
`resolveFieldForPath`, keyed by field id. Two of the core's path shapes are not fields: an unknown
answer key reports `/answers/<key>`, and a failed cross-field validation reports
`/rules/validations`. Both are returned under a reserved key rather than dropped, because silently
losing a cross-field error is how a form looks valid when it is not.

## Authorized scope

- `packages/colander-bindings/**` — the new package.
- Root workspace wiring: `pnpm-workspace.yaml` already globs `packages/*`, so only the root
  `vite.config.ts` source globs, `package.json` scripts, and the READMEs change.
- One example or test fixture that exercises the descriptors against a real compiled form.

## Non-goals

- **No rendering.** No JSX, no component, no framework dependency. Renderers are separate packages
  in a second phase, and the first one is React because the repository already has a React example.
- **No re-implementation of `apply-rules`, `FormDefinition` or `resolveFieldForPath`.** The
  dependency is `@ailura/colander-client`, and only that.
- **No talking to the core.** Descriptors consume definitions and rule state; the core stays behind
  a transport, and this package never imports `@ailura/colander`.
- **No `group` / `repeater` in v1.**
- **No re-validation of `type`.** The core validated the document or it did not; that is not this
  package's job, and `isKnownFieldType` already exists for the hand-authored path.

## Acceptance

- `createRegistry()` yields the nine native recipes; overriding one entry leaves the rest intact.
- An unknown `widget` resolves to the kind derived from `type`, and a descriptor is still produced.
- A `widget` the registry knows wins over `type`.
- A calculated field's descriptor reports `readOnly: true` and a `required` state that follows the
  evaluation rather than the schema baseline.
- A hidden field's descriptor reports `visible: false` and keeps its value.
- `groupErrorsByField` keys field errors by field id and preserves the `/answers` and
  `/rules/validations` entries under reserved keys.
- Every descriptor test runs without a DOM, and the package has no runtime dependency other than
  `@ailura/colander-client`.

## Tasks

- [ ] T1 Package skeleton, manifest, tsconfig, and the workspace wiring.
- [ ] T2 `ControlKind`, the native recipes, and `createRegistry` with partial override.
- [ ] T3 Widget-to-kind resolution with the `type` fallback.
- [ ] T4 `describeField`: label, value, options, constraints, state, aria.
- [ ] T5 `groupErrorsByField`, including the two non-field path shapes.
- [ ] T6 Tests against a real compiled form, plus the README.

## Commits

None. No commit has been requested for any of this repository's current work.
