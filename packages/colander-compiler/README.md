# @ailura/colander-compiler

Build-time compiler that turns the Colander core's semantic types into a component tree the consumer
owns.

The core decides what a field type **means**. This package never decides how it is **drawn**. A
consumer declares which component each type becomes, and the compiler writes the wiring: one module
per type, each forwarding exactly the properties the core declares for that type to exactly the
component the consumer named.

## What it does not know

The compiler has no branch on any component, framework, or library. Its entire input about
presentation is the consumer's mapping:

```ts
import type { ComponentMapping } from "@ailura/colander-compiler";

export const mapping: ComponentMapping = {
  shell: { module: "@/components/field-shell", export: "FieldShell" },
  components: {
    text: { module: "@/components/controls", export: "TextControl" },
    number: { module: "@/components/controls", export: "NumberControl" },
    // …one entry per materializable type
  },
};
```

From that and the core's table, it produces:

```
.colander/
  colander.map.json   the mapping, as data
```

One file, because that is all that is left to write. The prop types are published, the binding is
your own `defineControl` call, and the dispatcher is `renderColanderField`, so everything a form
needs either lives in the library or in your controls. What cannot be written by hand is the mapping
— it is discovered, not declared — and that is the one thing the compiler writes.

`group`, `repeater` and `component-ref` are containers, so no control is generated for them, and the
compiler says so by name rather than dropping them silently.

## Three ways to name a component

The compiler does not care where a component comes from, so a type picks the form that fits it:

```ts
components: {
  // A reference. The generated module imports it and wires the props.
  number: { module: "@/components/controls", export: "NumberControl" },

  // JSX, written at the mapping. Emitted into the generated module, which
  // imports what the expression names, so the type checker sees the result.
  text: {
    jsx: '<Input minLength={props.minLength} pattern={props.pattern} />',
    imports: { Input: "@/components/ui/input" },
  },

  // The component itself, when the module can be loaded where the mapping is.
  // `defineMapping` reads the export name off the function and skips the
  // repetition of naming it twice.
  boolean: BooleanControl,
}
```

A written expression is wired by you rather than by the generated module, and it is a single
expression rather than a component. `props` is in scope inside it. The shell may be written this way
too, and declares where the control goes with `{control}`:

```ts
shell: {
  jsx: `<Field>
  <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
  {control}
  {props.errors.length > 0 ? <FieldError errors={props.errors} /> : null}
</Field>`,
  imports: {
    Field: "@/components/ui/field",
    FieldLabel: "@/components/ui/field",
    FieldError: "@/components/ui/field",
  },
},
```

A shell that never places `{control}` is refused, because the control would be rendered nowhere.
Only the imports an expression actually names are emitted: a declared but unused import is dead
weight at best and a compile error under `noUnusedLocals` at worst.

**There is deliberately no fourth form.** A function that returns JSX, written inline, cannot be
lifted into another module: the toolchain rewrites JSX into runtime calls carrying module-private
identifiers, so the source of a live function is not portable. Asking for text, or for a component
in a module, asks for something that survives.

### `defineMapping`, and when it applies

`defineMapping` takes the module once and reads each export name off the component you wrote, so the
mapping cannot drift from the module it names:

```ts
import { defineMapping } from "@ailura/colander-compiler";

export const mapping = defineMapping({
  module: "@acme/design-system",
  shell: FieldShell,
  components: { text: TextControl, number: NumberControl },
});
```

It requires the components to be loadable from wherever the mapping is evaluated. A bundler
configuration is bundled and executed by Node, so it can import a package but not a module that
depends on a bundler-only alias. For a design system published as a package this works directly; for
a component that only exists inside the application, use a reference instead.

### JSX does not belong in a bundler configuration

A mapping written inline cannot carry JSX, and the plugin refuses one that tries:

```
The component mapping for the `text` control is not usable: it is written as JSX in the bundler
configuration, which is not a place for UI code; move the mapping to its own module and read it
with `resolveMapping`
```

This is a rule rather than a preference. A bundler configuration is bundled and executed by Node: it
cannot resolve a bundler-only alias, it drags a component tree into the config, and the JSX there
sits outside every type checker that matters. `resolveMapping` is the way out, and it is needed
anyway for a mapping in a module to be worth watching.

## Finding your controls

The mapping is a directory. One file per type, named after the type, each exporting its control by
default:

```
src/components/colander/
  text.tsx      export default defineControl("text", …)
  number.tsx    export default defineControl("number", …)
  choice.tsx    export default defineControl("choice", …)
  shell.tsx     export default function FieldShell(…)
  shared.tsx    whatever else you like
```

```ts
// vite.config.ts
colander({
  componentsDir: "src/components/colander",
  shell: "src/components/colander/shell",
});
```

There is no destination to configure. The tree is always written to `.colander/` at the root the
bundler resolved, so the CLI, the plugin and a human looking at the tree all find it in the same
place; `outDir` is refused rather than honored.

That is the whole configuration. A convention is checked where a hand-written list is not:

- **A type with no file fails the build**, naming the type. A field with no control renders nothing
  and can never be answered, so leaving one out is a decision — `omit: ["time"]` is how you say so.
- **A file naming no type is left alone.** `textt.tsx` and a helper beside the controls are not
  worth a line: a misspelling already fails, because the type it missed has no control, and that is
  reported by name. A run that found nothing wrong prints nothing at all: the plugin's output is
  about your project, not about the build, and a bundler's log is not where you look for a mistake
  the build has already caught.
- **Every control is imported by default**, and by a relative path, so the generated code needs no
  bundler alias and no `baseUrl`.
- **The shell is a prop** rather than a name, because it wraps every type and has none of its own.
  It draws the label, the description and the messages; a control draws only the control, which is
  why `ControlProps` does not hand it a label to draw twice.

The tree also contains `colander.map.json`: the same mapping as data, for a test, a tool, or another
generator to read. It is written from the same plan, and the drift guard covers it like every other
file in the tree.

For components that live somewhere a directory cannot describe — a design system published as a
package, or a control assembled from JSX — a mapping can still be spelled out in the plugin call, or
read through `resolveMapping`. Both are checked the same way.

## Semantic names travel verbatim

The core calls a numeric bound `minimum`. A browser calls it `min`. This package forwards `minimum`,
`maximum` and `multipleOf` unchanged, and the consumer's own control renames them:

```tsx
import { type ControlProps } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";

export function NumberControl({
  minimum,
  maximum,
  multipleOf,
  decimalPlaces,
  onChange,
}: ControlProps<"number">) {
  return (
    <Input
      type="number"
      min={minimum}
      max={maximum}
      step={typeUtilities.number.step({ multipleOf, decimalPlaces })}
      onChange={(event) => onChange(typeUtilities.number.answerFrom(event.currentTarget.value))}
    />
  );
}
```

`minimum` arrives as `minimum` and `multipleOf` as `multipleOf`. The rename to `min` and `max` is
the consumer's markup and belongs here; the `step` is not a rename at all, so it is the one property
in that example that needs a rule of its own, and the rule is not written by hand.

A compiler that knew the target's vocabulary would be coupled to one library, which is the coupling
this package exists to remove. The cost is one thin adapter per type, and the benefit is that a
property the core adds reaches the consumer as a `tsc` error instead of silently going nowhere.

## Usage

The mapping is written in the bundler configuration, next to everything else that describes the
project. There is no `mapping` key to unpack:

```ts
import { colander } from "@ailura/colander-compiler";

export default defineConfig({
  plugins: [
    colander({
      shell: { module: "@/components/field-shell", export: "FieldShell" },
      components: {
        text: { module: "@/components/controls", export: "TextControl" },
        number: { module: "@/components/controls", export: "NumberControl" },
        // …one entry per materializable type
      },
      prune: true,
    }),
  ],
});
```

Because the mapping is part of the configuration, editing it restarts the bundler, which re-runs the
generation from the new value. No extra wiring is needed.

A project that keeps its mapping in its own module reads it with `resolveMapping` instead. A mapping
in a separate file is a snapshot this plugin cannot evaluate, so without a loader an edit to it
regenerates the same bytes and the running app does not move:

```ts
import { mapping } from "./colander.components";

colander({
  ...mapping,
  resolveMapping: async () => (await import("./colander.components.ts?v=" + Date.now())).mapping,
  dependencies: ["colander.components.ts"],
  prune: true,
});
```

The tree is written as real files, not virtual modules: a generated control that `tsc` cannot see is
a generated control whose type errors nobody will find. A file is only rewritten when its bytes
change, so a run that produces the same tree leaves modification times alone and no watcher is told
about a change that did not happen.

## API

| Export                         | What it is                                                            |
| ------------------------------ | --------------------------------------------------------------------- |
| `planComponents(mapping)`      | the core's table plus a mapping to one plan per type, plus rejections |
| `defineMapping(declaration)`   | a mapping declared with the components themselves                     |
| `generateComponents(options)`  | plans to files on disk, reporting what it wrote and removed           |
| `colander(options)`            | the Vite plugin                                                       |
| `colander generate`            | the command: write the tree, without a build                          |
| `colander check`               | the command: fail when the generated tree is not current, for CI      |
| `assertGeneratedTreeIsCurrent` | the drift guard, for a test to call                                   |
| `ColanderCompilerError`        | every refusal this package makes, with `kind` and `subject`/`path`    |
| `HostFieldProps<V>`            | the contract a generated control is bound to                          |
| `./utilities`                  | the per-type decisions, on their own subpath                          |
| `typeUtilities`                | every materializable type's utilities, keyed by that type             |
| `DERIVATION_RULE`              | the rule the utilities obey, as the value `"core-declares"`           |

## The contract a control is written against

The props each type's control accepts are published, derived from the same table the generator
reads:

```ts
import { defineControl, type ControlProps } from "@ailura/colander-compiler/contracts"

export const NumberControl = defineControl("number", ({ minimum, multipleOf, value, onChange }) => (
  <input type="number" min={minimum} step={multipleOf} onChange={…} />
))
```

`ControlProps<"number">` is the core's own declaration for a `number` field: its context plus the
properties that type carries. A control cannot forget one, cannot carry one the core has not
declared, and cannot demand a property the document will never have — `defineControl` refuses that
at the component, naming the type, with no generation involved:

```
error TS2345: Argument of type '(props: ControlProps<"date"> & { pattern: string }) => null' is not
assignable to parameter of type 'ControlComponent<"date">'.
  Property 'pattern' is missing in type 'ControlProps<"date">' but required in type '{ pattern: string }'
```

That is the same check the generated module performs, read from the same table, so the two cannot
disagree. `controlContractFor(type)` and `allControlContracts()` expose the runtime half, for a
consumer that reports or builds on it.

## What a declared property means for one type

`plan` publishes the properties each type declares and `contracts` publishes their TypeScript types.
Neither says what those properties **mean** for the type they belong to. Every consumer re-derived
the same per-type facts and re-derived them separately, which is how the React example came to hold
a `step` rule for `number` in one file and a different, contradictory one for `integer` in another,
with no test on either.

`@ailura/colander-compiler/utilities` is the third thing this package publishes, and it is the
decision rather than the name: one module per type family, each utility taking that type's declared
properties and returning the plain value a control puts on an element.

### The core declares, the client does not invent

A utility derives only from properties the core declares for that type, and where the core is silent
it returns a non-restrictive answer rather than a guessed constraint. "Silent" is decided by the
locked contract corpus rather than by taste, and four of its cases decide the family:

- `multipleOf` on a `number` is enforced: `validate.json:4225` reports
  `Field 'n' must be a multiple of 0.5.`, so a step taken from it constrains nothing the core would
  not already reject.
- `multipleOf` on an `integer` is accepted and never enforced. `constraint-multipleof-integer`
  (`:4232`) and `constraint-multipleof-integer-ok` (`:4281`) both declare `"multipleOf": 0.5` and
  both return zero errors. An integer step that followed it blindly would make the element refuse
  integers the core accepts.
- `decimalPlaces` has zero occurrences anywhere in the corpus: the core states nothing about it, on
  any type.
- An empty text field is the core's decision. `readonly-field-empty-ok` (`:1258`) answers a text
  field with `""`, normalises it to `{}` under `REQUIRED_FIELD_MISSING` for a **different** field,
  and reports no `INVALID_TYPE` for the empty string, so the utilities forward `""` as `""` and
  substitute nothing for `null`.

That rule is why `step` is derived one way for `number` and another for `integer`. A reader who
skips it will read one of the two as a bug.

### One registry, keyed by type

`typeUtilities` is keyed by the type name and each entry carries that name with it, so a control
holding an entry knows what it is for without having kept the key:

```tsx
import { type ControlProps } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";

export function NumberControl({ multipleOf, decimalPlaces, onChange }: ControlProps<"number">) {
  return (
    <Input
      type="number"
      step={typeUtilities.number.step({ multipleOf, decimalPlaces })}
      onChange={(event) => onChange(typeUtilities.number.answerFrom(event.currentTarget.value))}
    />
  );
}
```

The member type is chosen by the key, so `typeUtilities.number.step` and
`typeUtilities.integer.step` are different functions with different parameter types: a
`NumberConstraints` object will not type-check where `IntegerConstraints` is expected, and an
integer control cannot be handed a `decimalPlaces` the core never declared for that type.

The registry is exhaustive over the core's own `MaterializableFieldType`, and the exhaustiveness is
a build error rather than a runtime `undefined`. Adding a tenth materializable type to the core's
table makes this package stop compiling until its entry is written, which is deliberate: a
derivation that has not been stated should stop the build, not arrive at a control as a lookup that
returns nothing.

### What each of the nine types gets

"Declared" means beyond the shell's own `title` and `description`; the last column is the corpus
case that decided what the utility may derive, where the rule was not already obvious.

| Type       | Declared                                            | Utilities                                                               | Decided by                                               |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `text`     | `minLength`, `maxLength`, `pattern`                 | `answerFrom`                                                            | `constraint-minlength` (`:3846`), `-maxlength` (`:3901`) |
| `textarea` | `minLength`, `maxLength`                            | `answerFrom`                                                            | as `text`; no `pattern` is declared                      |
| `number`   | `minimum`, `maximum`, `multipleOf`, `decimalPlaces` | `step`, `answerFrom`                                                    | `constraint-multipleof-number-in-range` (`:4225`)        |
| `integer`  | `minimum`, `maximum`, `multipleOf`                  | `step`, `answerFrom`                                                    | `constraint-multipleof-integer` (`:4232`, `:4281`)       |
| `boolean`  | nothing                                             | `checkedFrom`                                                           | `type-error-boolean-string`                              |
| `choice`   | `allowMultiple`                                     | `emptyValue`, `controlValue`, `answerFrom`, `has`                       | `choice-allow-multiple-single-string`                    |
| `date`     | nothing                                             | `formatAnswer`, `parseAnswer`, `answerFrom`                             | `date-normalization` (`:3349`)                           |
| `time`     | nothing                                             | `formatAnswer`, `parseAnswer`, `answerFrom`                             | `time-normalization` (`:3565`)                           |
| `datetime` | nothing                                             | `formatAnswer`, `parseAnswer`, `answerFrom`, `dateWithTime`, `midnight` | `datetime-normalization` (`:3457`, `:3467`)              |

### The numeric step is two rules, and `decimalPlaces` is only a hint

`stepForNumber` takes a `multipleOf` that is finite and positive and returns it. `stepForInteger`
returns the same number only when it preserves integrality — when it is whole, or the reciprocal of
one — and `1` otherwise, which is also what an integer field steps by when it declares nothing.

So `multipleOf: 2` steps an integer by `2`, and `multipleOf: 0.5` does too, because `1 / 0.5` is
exactly `2`. The example's old inline rule read `Number.isInteger(1 / multipleOf)` alone, which gave
`1` for that same `2` — wrong for exactly the case the corpus accepts. The expression was right for
a different reason than the one its comment gave, and both rules now live in one tested function.

`decimalPlaces` is the other half. It has no validation presence in the corpus at all, so a step
derived from it is `10 ** -decimalPlaces` and is the **control's** precision hint, never a
constraint the core stands behind. A `decimalPlaces` that is negative or fractional describes no
granularity, and is refused rather than turned into a step.

### Temporal answers: read tolerantly, write strictly

The parsers accept every shape the corpus proves the core accepts or emits, which is a wider set
than the three clean wire formats: an unpadded `2024-1-5` (`:3349`), a time carrying seconds like
`9:5:3` (`:3565`), and a datetime ending in `Z` (`:3457`) — including the normalised timestamp the
core itself produces, `2024-01-05T10:00:00.0000000+00:00` (`:3467`), which no one of the three
formats matches. `+00:00` is admitted for the same reason: the core emitted that exact string
itself, which is evidence of an accepted answer in the same way an input is. A parser that read
`09:05:03` and answered `{ hours: 9, minutes: 5 }` would be rewriting the answer in the client's
name, so the extra precision rides along in `ClockTime.seconds` and `DateTimeParts.offsetMinutes`.

The formatters write only the three clean shapes, `YYYY-MM-DD`, `HH:mm` and `YYYY-MM-DDTHH:mm`,
because a widget edits wall-clock minutes. **That costs something on the way back out**: a `time`
read as `09:05:03` is written back as `09:05`, and a `datetime` read as `2024-01-05T10:00:00Z` is
written back as `2024-01-05T10:00`. The value is not destroyed — the parsed parts still carry the
seconds and the offset — but nothing re-emits them, and there is deliberately no flag to make it do
so. Sub-second digits are read and dropped, which is bounded to a fraction the corpus only ever
shows as zero.

### What is deliberately absent

- **No utility for `pattern`.** `constraint-pattern` (`:3956`) rejects `"AB1"` against `^[a-z]+$`
  and `constraint-pattern-ok` accepts `"abc"`, but that pattern carries its own `^` and `$`, and
  every case in the corpus either matches the expression in full or does not contain it at all.
  Nothing distinguishes "the core anchors the pattern" from "the core searches with it", and a guess
  about a regex dialect is the one thing this package exists to remove. A consumer forwards the
  name; the element and the core decide what it means.
- **No utility for a property a control merely forwards under another name.** Forwarding a name is
  not a decision, and `controlPropsFor` (`runtime.ts:87`) already does it.
- **No constraints parameter at all for `date` and `boolean`.** They declare nothing beyond the
  shell's two properties, `title` and `description` (`host.ts:133`; `semantics.ts:157-160` for the
  boolean, `:167-170` for the date), and an empty constraints type would accept anything and mean
  nothing by it. Their absence is the contract.

### Why they live here and not in the client

`@ailura/colander-client`'s table is a transcription of the core and is deliberately silent about
derivation (`semantics.ts:6-23`), so restating the core's intent there would be the one thing that
package exists not to do. The consequence worth naming is on the import side: the utilities reach no
Node built-in, and a test walks that graph to keep it so, so a browser imports
`@ailura/colander-compiler/utilities` the same way it imports `@ailura/colander-compiler/runtime`.

## Two commands

```
colander generate --components-dir src/components/colander \
                  --shell src/components/colander/shell

colander check     --components-dir …
```

Both read the same directory the plugin reads and take what they need as flags, so neither needs a
bundler and neither can produce a tree the bundler would not. Both write `.colander/`; `--out-dir`
overrides it when a consumer needs the tree somewhere else. `check` exists because a stale tree
should be caught in CI rather than discovered while debugging a form;
`assertGeneratedTreeIsCurrent()` is the same check for a test, and `assertCompleteMapping()` covers
the other half — that a mapping still reaches every type the core can materialize.

## The tree is an artifact, not source

Add `.colander/` to your `.gitignore`. Nothing in it is written by hand: it is rewritten on every
run from the mapping and the core's table, so a committed copy could only ever disagree with the
source that produced it, and a reviewer reading a diff of it would learn nothing the generator did
not already know. The consequence is the flip side of writing real files: a fresh clone generates
its tree on the first build, and `tsc` sees it because the build ran first.

## Rendering a field

```ts
import { renderColanderField } from "@ailura/colander-compiler/runtime";
```

Import the **runtime** entry point from browser code, not the package root. This package is mostly a
build-time tool and a build-time tool needs Node; the root re-exports `check`, `discover`,
`generate` and `plugin`, so importing it from a form pulls `node:child_process` into a browser
bundle, where Vite externalises it and the import fails at runtime. The runtime entry reaches
nothing but React, the core and this package's own types, and a test walks that graph to keep it
that way. `./utilities` is held to the same rule, and a control reaches it by that subpath.

A form walks the core's tree and, at a leaf, knows the field's type as a value rather than as a
type. The generated tree does that dispatching, so the one place where an unknown answer becomes a
typed one lives in generated code where it can be seen, and a consumer writes none of it:

```tsx
// from a module under src/, the fixed tree is one level up
import { renderColanderField } from "../.colander";

renderColanderField({
  type: node.type,
  id: controlId,
  code: node.code,
  field: node.field,
  options: node.options,
  value: scope.get(node.code),
  onChange: (value) => scope.set(node.code, value),
  disabled,
  readOnly,
  required,
  label: node.label,
  description: node.description,
  errors,
});
```

## License

MIT
