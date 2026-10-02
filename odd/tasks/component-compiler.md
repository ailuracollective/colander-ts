# Compile Colander semantic types into a consumer-owned component tree

## Objective

Move per-type UI interpretation out of hand-written renderers and into a build-time compiler. The
Colander core declares, as data, which semantic properties each field type carries. A consumer
declares a mapping from semantic type to the component it wants to use. The compiler reads both and
generates one component per primitive type — `colander/text.tsx`, `colander/number.tsx`, and so on —
that forwards exactly the semantic properties that type declares to exactly the component the
consumer named. The compiler never learns what an "Input" is: it knows a property list, a component
reference, and how to write a file.

## Problem

`examples/react-app/src/components/form-runner.tsx` reinterprets the core's semantics by hand, in
an `if (node.type === 'boolean') … else if (node.type === 'choice') … else` chain that also owns
value conversion, the HTML `type` string, `step` derivation, and `min`/`max` forwarding. The core
already states the semantics — `Field` carries `minLength`, `maxLength`, `pattern`, `minimum`,
`maximum`, `multipleOf`, `decimalPlaces`, `minItems`, `maxItems`, `allowMultiple` — and the core owns
validation for every one of them. The renderer is the only place that knows those keys are real, so
the knowledge lives in one consumer, in a shape no other consumer can reuse, and it can silently
disagree with the core about which property a type actually accepts.

A second consumer would have to write the same chain again, in its own UI library. The compiler is
what makes the core's semantics executable by anyone.

## Scope

- Add a declarative semantic-property table to `@ailura/colander-client`: per type, the
  properties it carries, their TypeScript types, the answer value shape, and whether the type is a
  materializable control or a container.
- Add a new Node-only package `@ailura/colander-compiler` that turns the core's table plus a
  consumer mapping into a framework-neutral intermediate representation.
- Add a pluggable template layer, with a React/TSX template as the first implementation, that renders
  the representation to source text, including the derived prop types.
- Add a Vite plugin that regenerates and invalidates on change in development, and writes real
  files on disk during build so `tsc`, the IDE, and SSR see the same modules.
- Replace the react-app's per-type branches with the generated tree. The consumer keeps the walker,
  the rule state, and the answer scope; the compiler owns every per-type decision.

## Constraints

- The compiler must not know any UI library, framework, or component by name. Its only input about
  presentation is the consumer's mapping.
- The core's `Field` keys stay the wire contract. The semantic table describes those keys; it does
  not rename, normalize, or add them.
- The generated tree is disposable. It carries a generated-code header and is rewritten from the
  mapping on every run, so it never accumulates hand edits.
- `group`, `repeater`, and `component-ref` are containers, not materializable controls. The compiler
  generates no control for them and reports that explicitly rather than skipping them silently.
- Wire documents stay JSON strings and are forwarded without parse/stringify round trips.
- Technical artifacts, generated code, tests, and UI copy remain in English.
- Effective strict TDD is not configured; ordinary functional verification is required.
- No commit, push, pull request, or remote operation is authorized.

## Authorized scope

`packages/colander-client` (new semantics module, its exports, its tests), the new
`packages/colander-compiler` package, `examples/react-app` (mapping, shell, plugin wiring, generated
tree, walker rewrite, tests, README), the root `README.md` package table, and this feature document.
Existing unrelated worktree changes must remain untouched.

## Delivery forecast

- Estimated authored change: approximately 900–1400 lines across the semantic table, the compiler
  package, the React app rewrite, tests, and documentation.
- Delivery strategy: `ask-on-risk`; no remote delivery action.
- Rollback boundary: remove the compiler package, the client's semantics module, and the react-app
  mapping, plugin wiring, and generated tree; restore the previous `form-runner.tsx`.

## Work units

- [x] **T1 — Declare the semantics in the core.** Add the semantic-property table to
  `@ailura/colander-client` as data, with the value shape and TS type of every property per
  type, a container flag, and the props a generated control always receives. Export it from the
  package root and from a `./semantics` subpath, and cover it with contract tests. Route: bounded
  writer; trigger: new non-trivial module plus manifest and export surface.
- [x] **T2 — Build the representation.** Create `@ailura/colander-compiler` with the
  `planComponents` entry point: core table plus consumer mapping to one plan per materializable
  type, with a reason on every rejection and no partial plan on failure. Route: bounded writer;
  trigger: new package with several non-trivial modules.
- [x] **T3 — Render the React tree.** Add the template layer and the React/TSX template: emit
  `colander/types.ts` and one `colander/<type>.tsx` per type, deterministically, from the
  representation alone. Route: bounded writer; trigger: emitter, formatter, and tests.
- [x] **T4 — Wire build time and HMR.** Add the Vite plugin and the programmatic
  `generateComponents` entry point: emit on build, watch the mapping and the core's semantic
  surface in development, and invalidate exactly the affected generated module. Route: bounded
  writer; trigger: filesystem and Vite lifecycle integration.
- [x] **T5 — Materialize the semantics in the consumer.** Point the react-app at the compiler,
  declare its mapping, add its own field shell, commit the generated tree, and reduce
  `form-runner.tsx` to the walker and binding that are genuinely the host's. Route: bounded writer
  plus parent verification; trigger: multi-file consumer rewrite.

## Acceptance criteria

- The core states, as inspectable data, every semantic property of every type, and a test fails if
  the table names a property the wire `Field` type does not carry.
- The compiler's output changes only when the core's table or the consumer's mapping changes. The
  compiler has no branch on any component name, framework, or UI library.
- One file is generated per materializable type, each importing exactly the component the consumer
  named and forwarding exactly the properties that type declares.
- A consumer whose component does not accept a declared property fails at `tsc`, not at runtime.
- `group`, `repeater`, and `component-ref` produce no control and a stated reason.
- Editing the mapping in development regenerates the tree and updates the running app without a
  manual restart; a production build writes the same bytes the dev server served.
- `pnpm --dir examples/react-app test`, `test:ssr`, `lint`, and `build` results are recorded
  honestly, together with the new package's own suite.
- No commit, push, pull request, or remote operation is performed.

## Progress

- Feature document created before the first source write.
- Exploration route: inline read of the core contracts and the existing consumer renderer; the
  renderer and the semantic surface are the only two inputs this feature needs.
- TDD mode: ordinary functional verification; strict-tdd evidence is not configured.
- Engram mirror: created with the design decisions.
- T1 is done and verified: `packages/colander-client/src/semantics.ts`, its test, the root exports
  and the `./semantics` subpath. Unit 53 passed, typecheck, lint and format clean, build and the
  manifest audit pass with 14 published targets.
- The table's agreement with the wire model is enforced at compile time, not by convention:
  `Field` carries an index signature, so `keyof Field` cannot prove a key exists, and the module
  instead reads each property's value type back through `Field` and compares it to the declared
  one. Verified by mutation: declaring `minLength` as a `string`, and naming a key `Field` does
  not declare, both fail the build and name the offending property. A correct table compiles.
- Delegation route: two attempts at a bounded writer failed with an infrastructure error and wrote
  nothing. T1 was completed directly instead; further work units proceed directly for the same
  reason unless the writer recovers.
- T2, T3, T4 and T5 are done. The compiler package carries 73 tests, and the react-app 55.
- Verified, with real output: compiler `test:unit` 73 passed, `typecheck`, `lint`, `fmt:check` clean,
  `build` and manifest audit pass with 11 published targets. React example: `tsc -b` clean, `test`
  55 passed, `test:ssr` passed, `lint` 9 warnings and no errors, all of them pre-existing and none
  from the generated tree, `build` succeeded.
- Two design corrections were made during implementation, both found by tests rather than review.
  `ControlChange` now admits `null` for a text or number field, because a cleared field has no
  answer and the previous type could not express that. The Vite plugin now takes an optional
  `resolveMapping` loader: a mapping passed as a value is a snapshot, so a watched edit to it would
  have regenerated the same bytes and the running app would not have moved.
- The template refuses a lower-case export name, because JSX reads `<textControl />` as a host
  element and the file would compile while rendering nothing.
- Each generated component module exports exactly one component, and the property readers live in
  `props.ts`, so every control module stays a fast-refresh boundary.
- Consumer authority is enforced by `tsc`, not by the compiler: if a mapped control does not accept
  a property the core declares for its type, the generated module fails to compile.
- The committed tree is held to the mapping by a test that fails with a regeneration message; that
  test was verified to fail on a hand edit and pass again once the edit was reverted.
- Environment note: two react-app Vite dev servers were already running and restarted themselves when
  `vite.config.ts` changed, then regenerated the tree from a half-written configuration in memory.
  They were stopped with the user's explicit OK, after which every check above was run clean.

## Decisions

- A new package, not a module in the client. The client is headless with no dependencies; a
  build-time tool with a Vite-facing surface would change what that package is for.
- The compiler is split into a framework-neutral representation and a pluggable template. The
  representation is the part worth owning; the React template is the first consumer of it and is
  replaceable without touching the core.
- The generated files are real files on disk, not virtual modules. A generated control that `tsc`
  cannot see is a generated control whose type errors nobody will ever find.
- The plugin is named `colander`, and its mapping is written at the top level of the plugin call rather than behind a `mapping` key, so a project can declare its shell and its components in the bundler configuration itself. That form also removes the need for a re-read loader: Vite re-reads the whole configuration when it changes.
- A component can be named three ways, and a type picks its own: a reference, JSX written at the mapping and emitted into the generated module, or the component function itself through `defineMapping`. A fourth form — a function returning JSX, written inline — is deliberately absent: the toolchain rewrites JSX into runtime calls carrying module-private identifiers, so a live function's source is not portable into another module. Verified against this repository's own loader, which produced `(p) => (0,__vite_ssr_import_0__.jsxDEV)(...)`.
- The shell may be written as JSX too, declaring where the control goes with a `{control}` slot. A written expression cannot be opened around something injected, so the shell states the point once and the compiler fills it. A shell that never places the slot is refused, because the control would render nowhere. Only imports an expression actually names are emitted, and imports for the same module are merged, so a shell and a control that both use `Field` do not collide.
- The whole setup can live in a `colander.config.{ts,mts,js,mjs}` file, discovered by the plugin, so `vite.config.ts` is one line. This is the form that carries JSX: the file is loaded by the plugin, not by the bundler's config bundle. `colander({})` with no arguments reads it, and a mapping given inline still wins over a discovered file. `outDir` is never guessed: writing a generated tree beside `package.json` because nobody said where it belongs is worse than a build that stops and says so.
- JSX is refused in a mapping written inline in the plugin call, with the reason in the error. A bundler configuration is bundled and executed by Node, so it is the worst possible home for UI code, and a mapping module needs `resolveMapping` anyway to be worth watching. The react-app therefore reads its mapping through the loader and `pnpm run generate` exists so the tree can be refreshed before `tsc` runs.
- `defineMapping` requires the components to be loadable where the mapping is evaluated. A bundler configuration is bundled and executed by Node, so a mapping that imports the application's own components through a bundler-only alias fails to load; `defineMapping` fits a design system published as a package, and the react-app therefore keeps its mapping as references.
- The consumer mapping names a component per type and one field shell. The shell is the consumer's
  own label/description/error presentation, which is presentation by definition and must not be
  assumed by the compiler.
- The generated tree is committed, so a clean checkout type-checks before any build runs. A test
  holds the committed bytes to what the mapping and the core's table produce, so the tree cannot
  drift without a failure that names the file.
