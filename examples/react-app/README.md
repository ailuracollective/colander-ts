# React + Colander form runner

This example uses TanStack Start for server rendering and hydration, TanStack Form
(`@tanstack/react-form`) for the React answer and submission layer, and native HTML controls for
rendering. The React UI depends on the source-agnostic `@ailura/colander-client` package for wire
contracts and form-model helpers. The React example owns two delivery adapters:

- HTTP samples call the NestJS example through `/api/forms/*`.
- Direct samples call the packed `@ailura/colander` WebAssembly binding in the browser. They never
  call the HTTP transport or the NestJS API.

The form model and rule state remain headless. The selected transport is passed into the
presentation layer, so changing samples does not change a process-wide transport switch.

## Prerequisites

- Node `>=20.19.0` at runtime; the workspace development toolchain is Node
  `^22.18.0 || ^24.11.0 || >=26.0.0`.
- pnpm `12.3.4`, Vite 8, Vitest 5, and TypeScript 6 for this app.
- The three current local archive aliases at the repository root: `ailura-colander.tgz`,
  `ailura-colander-client.tgz`, and `ailura-colander-browser.tgz`. The matching versioned publish
  archives are also generated; all are intentionally gitignored.
- For HTTP samples only, the NestJS example running on port 3000:
  `pnpm --dir examples/nest-app start`.

Use the root offline package and consumer flow:

```bash
pnpm install --frozen-lockfile
pnpm run pack
pnpm --dir examples/react-app install --offline --frozen-lockfile
```

`pnpm run bootstrap` performs the archive check, frozen install, build, tests, SSR check, and
packed-consumer verification in one command. `pnpm run release:pack` is the separate network-backed
WASM rebuild path.

The React dependencies are deliberately local `file:` tarballs; the example does not use a registry
copy of any Colander package. The isolated workspace overrides the browser package's transitive
core/client versions to the same stable aliases for offline installation.

## Run and verify

```bash
pnpm --dir examples/react-app dev        # TanStack Start SSR at http://localhost:5173
pnpm --dir examples/react-app test:ssr   # Node-only Start SSR proof
pnpm --dir examples/react-app test       # focused Vitest tests, no Nest server
pnpm --dir examples/react-app build      # TypeScript and Start production build
pnpm --dir examples/react-app lint       # Oxlint
```

TanStack Start supplies the client and server entries, renders the document from
`src/routes/__root.tsx`, and hydrates the `/` route from `src/routes/index.tsx`. The generated
`src/routeTree.gen.ts` is maintained by the Start router tooling; do not edit it by hand.

### SSR boundary

The server render creates the HTML document and the existing `App` shell, but it does not run React
effects. Consequently, SSR does not call `colander.load()`, does not access `window` or `document`,
and does not require a browser DOM. The WASM transport remains client-side: the browser's existing
effect starts the packed-core load when a WASM sample is selected. HTTP samples continue to use
`/api/forms/*` through the Vite dev proxy.

`pnpm --dir examples/react-app test:ssr` uses the documented Start render handler with a Node
`Request` and `react-dom/server`; it asserts the app shell in the initial HTML and verifies that the
WASM loader was not called. The existing transport tests remain separate and still exercise the Node
disk-loading path.

The Vite dev proxy maps `/api` to `http://localhost:3000` and strips the prefix. Set
`VITE_API_BASE_URL` when the HTTP service is hosted elsewhere. Direct samples do not need that proxy
or a running Nest process.

## Color theme

The header's `Color theme` selector offers `System`, `Light`, and `Dark`. `System` follows the
operating system's `prefers-color-scheme` setting and continues following it while the page is open.
`Light` and `Dark` override the system preference and, when browser storage is writable, survive
reloads through one namespaced storage entry. `System` is stored as its own value so it replaces an
older explicit choice. Missing, malformed, or inaccessible storage safely falls back to `System`; if
a save fails, the current selection still applies for the session and the header reports the
non-persistent choice. A small inline head bootstrap applies the selected appearance before
hydration.

## Execution sources

Every sample declares `execution: 'http' | 'wasm'`. The selector shows the active source and the app
composes a small API facade around the selected `ColanderTransport` port:

- `src/lib/http-colander-transport.ts` owns fetch, `/api/forms/*` paths, response validation, and
  HTTP error mapping.
- `src/lib/wasm-colander-transport.ts` is a thin compatibility factory over `createWebColander` from
  `@ailura/colander-browser`. The browser package owns lazy loading, shared loads, retry, panic
  recovery, and neutral error adaptation; React owns no second WASM lifecycle implementation.

Calling the direct adapter does not mean that the browser performs no network activity. In a
browser, the core may fetch the package's same-origin `wasm/colander.wasm` asset. That asset request
is the only expected fetch for a direct sample; it is not a call to `/api/forms/*` or to NestJS. The
existing transport tests use the package's Node disk-loading path; the SSR test does not load WASM
at all. If the asset is missing or cannot be fetched, the UI reports the selected WASM source as
unavailable instead of claiming that a backend is required.

## Samples

The original BMI and blood-pressure cases remain available. The additional cases are authored
analogues in the spirit of the repository's golden coverage; they are not claimed to be exact
upstream golden vectors.

- `bmi` — HTTP calculation; `body.bmi` is `22.86` for the prefilled values.
- `bp` — HTTP cross-field validation; the stable `BP_SYSTOLIC_GT_DIASTOLIC` code is asserted without
  matching message text.
- `dynamic-household` — HTTP `visibleWhen`, `enabledWhen`, `requiredWhen`, and a calculated capacity
  value.
- `access-matrix` — HTTP nested group, multi-select, and repeater rows with prefilled values.
- `component-address` — HTTP component-ref compilation with a caller-supplied
  `ComponentReference[]`; the address component expands into child fields.
- `casework-intake` — HTTP extreme scalar casework intake with nested component expansion,
  conditional rules, chained calculations, and stable review validations.
- `wasm-casework-intake` — the same casework documents through the direct packed-WASM source, with
  no HTTP forms request.
- `wasm-bmi` — direct packed-WASM calculation with no HTTP request.
- `wasm-dynamic-household` — direct packed-WASM dynamic rules, calculation, and validation source.

### Extreme casework intake

`casework-intake` and `wasm-casework-intake` are paired catalog entries for one shared, scalar-only
eligibility casework model. The caller supplies `casework-context` version `1.0.0`; compilation
expands it into nested contact and household groups while preserving globally unique field IDs and
codes.

The prefilled review case uses phone contact, household size `3`, and annual income `1200`. Phone
contact and the review reason are visible, enabled, and required. The chained read-only calculations
produce adjusted income `1450`, household total `4350`, and eligibility score `3350`; a valid
Complete submission succeeds. Removing the review reason is valid in Draft but returns
`REQUIRED_FIELD_MISSING` in Complete. Income `1600` returns `CASEWORK_HIGH_INCOME_REQUIRES_REVIEW`,
while household size `5` returns `CASEWORK_LARGE_HOUSEHOLD_REQUIRES_REVIEW`.

The HTTP entry sends these documents through `/api/forms/*`. The direct-WASM entry uses the packed
browser core and makes no `/api/forms/*` request; a browser may fetch only the same-origin WASM
asset. This keeps the existing source-isolation architecture intact.

This validated scenario intentionally contains only scalar answers. Repeaters and multi-select
arrays remain represented by `access-matrix`, but final response validation for those arrays is
still a separate unsupported boundary in the current packed core.

Values are keyed by field code. Rule visibility, enablement, and required maps are keyed by field
id. Group children stay flat in the answer object, while a repeater is an array of row objects keyed
by child codes. Hidden answers are retained. The native form uses `noValidate`; Colander remains the
final validation authority.

## Boundary and data flow

1. The selected sample's object documents are serialized once by `createSampleCompileRequest`. Every
   `...Json` field is JSON text. The helper passes caller-owned `components` through the client's
   `createCompileRequest` contract.
2. The selected transport returns compiled strings. The React app passes those strings to
   `createFormDefinitionFromCompiled` for a read-only renderer model, but later requests forward the
   compiled strings verbatim. The adapter does not parse and re-serialize wire results.
3. TanStack Form stores one form value, `{ answers: Record<string, unknown> }`. Native field edits
   and repeater row edits read and write that object through `form.getFieldValue('answers')` and
   `form.setFieldValue('answers', next)`. Dotted field codes remain literal keys.
4. User changes update the TanStack Form values locally and invalidate any older in-flight rule
   evaluation. Rule evaluation is deliberately deferred until submission, so typing does not issue
   `evaluateRules` requests. The package's pure `applyEvaluation` applies visibility, enablement,
   required, and calculated values without removing hidden answers or creating a feedback loop.
5. Submission evaluates the current answers through the selected transport's `evaluateRules`,
   applies the resulting rule state, and then calls `validateResponse` in Draft or Complete mode.
   Response JSON pointers are resolved through the same definition and shown beside the relevant
   field and in the validation panel.

## Layout

- `src/routes/__root.tsx` — Start document boundary, metadata, stylesheet, and client scripts.
- `src/routes/index.tsx` — the `/` route that renders the existing `App` component.
- `src/router.tsx` — the fresh-router factory consumed by Start on each request.
- `src/routeTree.gen.ts` — generated route tree; do not edit it manually.
- `src/lib/wasm-colander-transport.ts` — React's direct packed-WASM adapter.
- `src/lib/http-colander-transport.ts` — React's HTTP adapter.
- `src/lib/api.ts` — injectable transport composition and source-neutral error normalization.
- `src/samples.ts` — sample catalog, explicit execution metadata, component references, and
  compile-request helper.
- `src/components/form-runner.tsx` — TanStack Form-backed walker: it binds answers, applies rule
  state, renders containers, and hands each leaf to the generated control for its type. It contains
  no branch on a field type.
- `src/components/colander/field-shell.tsx` — this application's label, description, and error
  presentation.
- `src/components/colander/controls.tsx` — this application's materialization of each semantic type.
- `src/components/colander/` — one file per semantic type, each a default export, which is how the
  compiler finds them; plus `shell.tsx` for the frame around a control, `shared.tsx` for the
  plumbing several controls use, and anything else the project keeps beside them.
- `src/components/ui/checkbox.tsx`, `src/components/ui/select.tsx`, `src/components/ui/field.tsx` —
  shadcn primitives the controls are built from; each control is the immediate equivalent for its
  type rather than a hand-rolled element.
- `src/components/ui/field.tsx` — shadcn's `Field` family, which holds the label, description and
  errors of every generated field.
- `.colander/` — the generated tree; gitignored, and rewritten by `pnpm dev` and `pnpm build`. A
  fresh checkout runs `pnpm generate` before it has one.
- `src/components/` — source status, rule inspector, validation panel, and existing UI primitives.

The public form-model module is imported directly from `@ailura/colander-client`; there is
intentionally no React-local `form-definition.ts`, `apply-rules.ts`, or duplicate
`colander-types.ts`.

## The generated component tree

`@ailuracode/colander-compiler` writes one file, `.colander/colander.map.json`, from two inputs: the
core's semantic table, which says what a `number` field _is_ (`minimum`, `maximum`, `multipleOf`,
`decimalPlaces`), and the controls in `src/components/colander`, which say what it is made of
_here_. Neither the compiler nor the core names a component; swapping this application's controls
produces a different tree with no change to the core. The tree has one fixed home and is a build
artifact: nothing in it is written by hand, and a fresh checkout has none until `pnpm generate` has
run.

There is no configuration file. `colander.config.ts` is gone, and so is the mapping: the compiler
finds the controls by convention, one file per type in `src/components/colander`, each exporting its
control by default, plus a `shell.tsx`. `vite.config.ts` says where that directory is.

Each control is declared with `defineControl` against `ControlProps<"number">` and friends — the
contract the core publishes for that type — so a control cannot forget a property the core declares,
cannot carry one it does not, and cannot demand one a document will never have, and that check
happens while the component is written, with no generation involved. The property names arrive as
the core gives them; renaming them for a particular element is the control's own job.

A type with no control file fails the build rather than rendering nothing, and `omit` is how a
project says it deliberately does not want one.

Each control is the immediate shadcn equivalent for its type — `Input`, `Textarea`, `Checkbox`,
`Select` — and renames the core's property names for the element it draws, which is the only place
in the project where `minimum` becomes `min`. The shell draws the label, the description and the
messages, using shadcn's `Field` family, so a control is only the control.

The rules that keep that honest:

- Semantic property names travel verbatim. The core's `minimum` arrives at `NumberControl` as
  `minimum`, and that control renames it for the DOM. The compiler never learns a target vocabulary.
- A property the core adds to a type becomes a `tsc` error — in the generated module when the
  control is written JSX, in `controls.tsx` when it is a component — until it is handled. That is
  where consumer authority is enforced, not in the compiler.
- `group`, `repeater` and `component-ref` are containers, so no control is generated for them and
  the generation reports each one by name.
- The tree is real files on disk, not virtual modules, so `tsc` and the editor resolve exactly what
  the bundler does.
- `colander generate` and `colander check` come from the library, so this project keeps no script of
  its own. `pnpm run check:generated` is the CI gate, and `src/lib/generated-tree.test.ts` is the
  same drift guard as a test.
- `renderColanderField` comes from `@ailura/colander-compiler/runtime`, not from the package root:
  the root is the build-time half and reaches `node:child_process`, which a browser bundle cannot
  resolve.

In development, editing `colander.components.ts` regenerates the tree and updates the running app
without a restart. A production build writes the same bytes the development server served.

## Known packed-core boundary

The current packed `colander` 0.1.0 core can evaluate rules for a repeater or multi-select request,
but its response-validation ABI rejects array-valued answer JSON with
`ColanderError.kind === 'validation'` (`Nested JSON arrays are not supported as answer values`). The
`access-matrix` sample therefore focuses on the required request/UI shape and rule evaluation; its
focused test does not pretend that the current core can validate that array-bearing response. This
is a core limitation, not an HTTP fallback or a transport error, and the UI reports the validation
error honestly.

The package manifests retain their existing license metadata. This checkout has no approved license
file to copy into local archives; the release owner must add the repository-approved license text
before publication.
