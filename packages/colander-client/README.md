# @ailura/colander-client

`@ailura/colander-client` is the source-agnostic Colander contract package. It owns the operation
port, neutral discriminated failure model, wire types, event contracts, and reusable headless
form-model utilities. It does not select a delivery mechanism and has no dependency on
`@ailura/colander`, React, HTTP, a browser, or WebAssembly.

## Public API

The package exports:

- `ColanderTransport` for core identity, compilation, content hashing, rule evaluation, response
  validation, schema validation, and next-version operations.
- `ColanderEventSource`, `ColanderEvent`, and `ColanderEventListener` for source-neutral event
  streams.
- `ColanderTransportError`, `ColanderErrorBody`, `ColanderFailure`, `ColanderFailureBody`,
  `ColanderErrorKind`, and the complete `ColanderTransportErrorKind` union: `invalid_request`,
  `validation`, `panic`, `unavailable`, `network`, `operation`, and `unknown`.
- `toColanderTransportError` for adapting a structurally compatible core or adapter error without
  losing its category.
- Wire request/result types, including `ComponentReference` and `CompileRequest.components`.
- `createFormDefinition` for an object-first, renderer-neutral form definition.
- `createFormDefinitionFromCompiled` as the one-time compiled-wire decoder.
- `createCompileRequest`, `createEvaluateRulesRequest`, and `createValidateResponseRequest` as
  explicit source-boundary helpers.
- `resolveFieldForPath`, `coerceAnswers`, and `humanizeCode` for renderer-neutral form metadata.
- `applyEvaluation` and `createRuleState` for pure id/code-aware rule state.
- `describeField` and `groupErrorsByField` for the runtime control descriptor and for errors grouped
  onto field ids.

The form-model helpers are also available through `@ailura/colander-client/form-definition`,
`@ailura/colander-client/apply-rules`, `@ailura/colander-client/semantics` and
`@ailura/colander-client/describe`.

## Describing a field

`describeField` answers the question every renderer otherwise re-derives for itself, once per
project: draw this field, with that control, in this state, with these errors. It takes a leaf node,
a `RuleState` and that field's errors, and returns a `ControlDescriptor` — identity, label, the
current value, normalized options, the constraints this type carries, the effective flags, the
errors, and the `aria` pair. The compiler's generated controls are static per type; everything here
is per field instance and per moment.

```ts
function describeField(
  node: LeafNode,
  state: RuleState,
  errors?: readonly FieldError[],
): ControlDescriptor;

function groupErrorsByField(
  definition: FormDefinition,
  errors: readonly ResponseError[],
): Readonly<Record<string, readonly FieldError[]>>;
```

`groupErrorsByField` is the other half: it maps a validated response's errors onto field ids, so a
field is handed exactly its own errors and a renderer never has to walk paths.

```ts
import { createRuleState } from "@ailura/colander-client";
import { describeField, groupErrorsByField } from "@ailura/colander-client/describe";
import { createFormDefinitionFromCompiled } from "@ailura/colander-client";

// `compiled` is the core's compile result and `described` its describe result,
// both already in hand from the transport.
const definition = createFormDefinitionFromCompiled(compiled, described);
const state = createRuleState(answers, definition);
const grouped = groupErrorsByField(definition, response.errors);

for (const node of definition.root) {
  if (node.kind !== "field") {
    continue;
  }
  const control = describeField(node, state, grouped[node.id]);
  // control.type, control.value, control.options, control.state.required,
  // control.aria.invalid, control.errors — everything one field needs.
}
```

A few things the descriptor decides, so two renderers reading the same form agree:

- **Options are normalized for `choice` only.** `label` falls back to `value` when the document
  omits it, and `selected` is computed against the value: an `allowMultiple` choice selects by
  membership, a single-select by equality. Every other type gets `[]`.
- **Constraints keep the core's wire names.** `minimum` and `maximum`, not `min` and `max`, and only
  what the core's own semantic table declares for that type — a `number` gets no `pattern`.
- **`required` follows the evaluation, not the schema.** Every effective flag falls back to the
  node's baseline, so a field no rule has mentioned is still described.
- **A hidden field keeps its value.** `state.visible` is `false` and nothing is cleared, because
  `RuleState` deliberately retains hidden answers.
- **A calculated field is read-only**, whatever the evaluation says: the core owns that value.
- **The descriptor is total.** A type outside the core's vocabulary still produces a descriptor,
  with empty `constraints` and empty `options`, and never throws.

### Cross-field errors are not dropped

`groupErrorsByField` drops nothing, because a cross-field error that silently disappeared is how a
form looks valid when it is not. An error resolving to a field is keyed by that field's id, and an
`/answers/<code>` error whose code names a field is keyed by that field too — the field is what
failed. Everything else lands under one of three exported keys:

| Key                    | What lands under it                                            |
| ---------------------- | -------------------------------------------------------------- |
| `ANSWERS_ERROR_KEY`    | an `/answers/<code>` error for a key the form does not declare |
| `RULES_ERROR_KEY`      | a `/rules/validations` failure, owned by no single field       |
| `UNRESOLVED_ERROR_KEY` | a path that resolves to nothing at all                         |

They are exported by name so a renderer enumerates them instead of guessing at string literals.

### What the descriptor deliberately does not do

- **No rendering.** No JSX, no component, no framework dependency, no DOM. It states what a field
  is; drawing it stays with the renderer.
- **No re-implementation.** `FormDefinition`, `createRuleState` and `resolveFieldForPath` are
  dependencies, read as they are.
- **No `group` / `repeater`.** `describeField` takes a `LeafNode`, and a container has no answer of
  its own to describe.
- **No `widget` axis.** The core does not validate `widget` and the semantic table is the
  vocabulary; a renderer that wants a component library chooses one from the type.

## Contract rules

Every `...Json` request field is JSON text held in a string. Adapters forward compiled documents and
`answersJson` without parsing and re-serializing them because the content hash covers the exact
document bytes.

`createCompileRequest` accepts optional `components` and includes them in the returned
`CompileRequest`; callers no longer need a second component workaround. The returned request owns a
component-array copy, while the input documents are serialized only at this explicit boundary.

`FormDefinition`, `FormNode`, `RuleState`, and public result fields expose readonly properties. A
form definition is an index for consumers, not a mutable renderer store.

## Development

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @ailura/colander-client run build
pnpm --filter @ailura/colander-client run check
pnpm --filter @ailura/colander-client run test:unit
pnpm --filter @ailura/colander-client run test:contract
pnpm run audit
```

The package supports Node `>=20.19.0` at runtime. The workspace development toolchain uses pnpm
`12.3.4`, Vite+ `1.0.0-rc.0` (Vite 8 / Vitest 5), and TypeScript 5.9. The package has no runtime
dependencies.

## License limitation

The manifest retains its existing MIT declaration. This checkout has no approved license file to
copy into the archive; the release owner must add the repository-approved license text before
publication.
