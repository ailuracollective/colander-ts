# Dynamic form system: authoring, versioning, and responses on SQLite

## Objective

Turn the two examples into one system for creating and consuming dynamic forms.
A person authors a form (fields, nested groups, components, UI metadata, rules)
in the browser; the Colander core stays the authority that compiles it, describes
it, evaluates it and validates responses; SQLite stores the definitions, their
immutable published versions, and every response with its validation result.

Today nothing is persisted: `examples/nest-app` is a stateless proxy over the
core and `examples/react-app` renders documents hardcoded in `samples.ts`.

## Chosen shape

- **Host:** `examples/nest-app` gains persistence and resource endpoints. The
  existing `/api/forms/*` computation routes are untouched; new resources live
  under `/api/definitions` and `/api/responses` so no route collides.
- **Authoring:** a visual editor — drag field types and components into a
  tree, edit properties in an inspector, watch the core validate live.
- **Database:** SQLite through Drizzle ORM. Driver is `@libsql/client` with
  `drizzle-orm/libsql`, because Drizzle 0.45.3 has no `node:sqlite` driver and
  libsql ships prebuilt binaries instead of a node-gyp build. Migrations are
  drizzle-kit SQL files.
- **Persisted:** definitions, versions (draft → published, published
  immutable), and responses with their validation result.

## Task map

- [x] **T1 — Persistence foundation.** Drizzle schema, migrations, the
  published-version immutability trigger, the connection module, and the
  forms/versions repository with tests. *This is the base everything else sits
  on and it is done first.* `npx tsc -b` clean, 24 unit tests and 5 e2e green.
  The delete trigger was corrected during review: the first version opened an
  escape hatch through a public flag table, and it now keys on the parent row
  existing instead, so no writer can weaken it from SQL.
- [x] **T2a — Definitions resource.** `DbModule` wiring the Drizzle database into
  the Nest container, and `@Controller("definitions")` with all thirteen routes.
  The publish gate is `ColanderService.compile`, not `validateSchema`: with no
  `schemas` map the core answers `schemas is required` for every document, so as
  a gate it would `400` every publication. `npx tsc -b` clean, 24 unit and 13 e2e
  tests green.
- [ ] **T2b — Responses resource.** `@Controller("responses")`: submit validates
  against the published version and stores the result either way, list, and
  fetch by id.
- [x] **T3 — Consume from the React app.** `GET /definitions/:id/published` feeds the
  existing compile → describe → `FormRunner` chain through the same source-neutral
  facade the samples use. `DefinitionsApiError` is a separate class, not an
  extension of `ColanderApiError`: `no_published_version` is a repository state
  the core can never report, so putting it in the core transport's union would
  make that transport claim a state it does not own. Verified end to end — a
  definition created through the API, published, stored and rendered at
  `/forms/:id`, with the stored bytes byte-identical to what was sent.
- [x] **T4a1 — Editor document model.** `src/editor/document-model.ts` holds a
  document in memory, edits it, and produces stored text exactly once. 43 tests
  over the real nest-app fixtures. Three guarantees, each proven by a test: one
  `JSON.stringify` in the module and it is inside `serialiseDocuments`; unknown
  keys survive because every edit writes into the live `raw` object rather than
  projecting a new one; the twelve-type list is closed and illegal moves are
  refused with codes. `componentCode`/`componentVersion` are exposed as *document*
  properties of a `component-ref`, deliberately outside the control-property
  table, because a reference that names no component is a valid shape that fails
  to compile.
- [x] **T4a2 — Tree, palette, inspector.** The three components over that model, plus
  `/editor/new` so the piece is visible in a browser rather than only in tests.
  Verified by driving the browser over CDP, which found three defects that a green
  suite did not: a white screen on any form with an unanswered `choice` (which
  also hit the *runtime*, not only the editor), a model index that lost a node so
  the inspector could not resolve an already-added field, and a mislabelled
  content hash. The `unansweredValue` fix lives in the compiler, per family, and
  the registry's exhaustiveness check turns a new core type into a compile error.
- [x] **T4b — Drag and drop.** The explicit add/remove/up/down controls stay: a drag
  is not keyboard reachable. The drag keeps no legality list of its own: it hands
  the route a position, the model rules, and a refusal is surfaced where every
  other refusal is. 40 tests over the pure address arithmetic, all asserting
  through `moveNode` against the document the model builds. Verified in a browser:
  a reparent, a move to the end, three refusal cases, and the three bands of the
  drop indicator, whose presence provably does not resize the box being measured.
- [x] **T4c — Rule builder.** `visibleWhen`, `enabledWhen`, `requiredWhen` and
  `calculate` as expression trees, not as text. The operator field is free text
  with the observed fourteen as suggestions, and the caption says plainly that the
  list is observed rather than declared: a known name reads "one this repository's
  samples use", an unknown one says the name is not a refusal and points at
  compile. Nothing on the write path consults the list. Orphaned rules are kept and
  listed at the top of the panel, because an orphan has no field and therefore no
  row to select, so a notice attached to the selection would itself be
  unreachable. 41 rule tests; the model 52 → 62. Verified in a browser: the kind
  switcher, the argument up/down/remove controls, the reference field, and the
  rules document appearing on write.
- [ ] **T5 — Editor integration.** Routes, navigation, and wiring the editor to
  the resource API with the draft/published lifecycle.
- [ ] **T6 — Responses in the app.** Submit a response, persist it, list and
  reopen submissions.
- [ ] **T7 — Verification pass.** `tsc -b`, both test suites, and headless
  screenshots of the editor, the runtime, and the responses list.

## T2 resource API contract

Written now so the runtime (T3), the editor (T4) and the API (T2) have one
target instead of three guesses. Field names are fixed; the implementation must
match them.

### Why drafts may be invalid and publications may not
A draft is a work in progress, so saving one never asks the core for permission
— that would make the editor unable to save a half-built form. Publication is
the gate: the core must accept the document before the version is marked
published and frozen. The dry-run that the editor uses to validate live is a
separate read, never a write precondition.

### Endpoints

`@Controller("definitions")` — deliberately not under `forms`, because
`GET /forms/core` is registered first and would swallow `GET /forms/:id`.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/definitions` | every definition with its version count and whether it is published |
| `POST` | `/api/definitions` | `{ name, description? }` → definition |
| `GET` | `/api/definitions/:id` | one definition with its versions |
| `PATCH` | `/api/definitions/:id` | rename / redescribe |
| `DELETE` | `/api/definitions/:id` | delete; cascades to versions and responses |
| `POST` | `/api/definitions/:id/versions` | create a draft from the document strings; stores them as received |
| `GET` | `/api/definitions/:id/versions` | every version with status, version number and created/published timestamps |
| `GET` | `/api/definitions/:id/versions/:versionId` | one version, plus a `schemaCheck` dry-run the editor can render live |
| `PATCH` | `/api/definitions/:id/versions/:versionId` | update a **draft**; a published version is 409 |
| `POST` | `/api/definitions/:id/versions/:versionId/publish` | the core must accept the document first, then the version is published, frozen and given its content hash |
| `POST` | `/api/definitions/:id/versions/:versionId/clone` | clone a version into a new editable draft; the source is untouched |
| `DELETE` | `/api/definitions/:id/versions/:versionId` | delete a **draft**; a published version is 409 |
| `GET` | `/api/definitions/:id/published` | the published version, 404 when the form has none — this is what the runtime consumes |

`@Controller("responses")`

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/api/responses` | `{ formId, answersJson }` against the published version; the core validates, and the response is stored with that validation result even when invalid |
| `GET` | `/api/responses` | `?formId=` required; lists that form's responses |
| `GET` | `/api/responses/:id` | one stored response with its validation result |

### Status codes
`400` a malformed body or a document the core rejects at publish time, carrying
the core's own message. `404` an unknown id or a form with nothing published.
`409` a published version being edited, deleted or published again.

### The bytes are the contract
Every `…Json` field in and out is JSON **text**, exactly as the existing
computation routes already require. A stored version keeps the text the core
hashed, and responses keep the answer text that was validated. Nothing on this
path parses and re-serializes a document, because that changes the content hash.

## Repository surface T2 is written against

Delivered by T1 in `src/db/forms.repository.ts`. The API layer calls these and
maps their typed errors onto status codes; it never touches Drizzle directly.

`FormsRepository` methods: `createDefinition`, `getDefinition`, `listDefinitions`,
`updateDefinition`, `deleteDefinition`, `createDraft`, `getVersion`,
`getLatestVersion`, `getLatestPublishedVersion`, `listVersions`, `updateDraft`,
`publishVersion`, `cloneLatestAsDraft`, `deleteDraft`, `submitResponse`,
`listResponses`, `getResponse`.

`FormsRepositoryError` codes and the status each maps to:

| Code | Status |
|---|---|
| `definition_not_found`, `version_not_found` | `404` |
| `no_published_version` | `404` |
| `version_not_draft`, `version_already_published`, `version_immutable` | `409` |
| `response_version_not_published`, `response_version_mismatch` | `409` |
| `duplicate_version` | `409` |

## Data model

```
form_definitions  id, name, description, created_at, updated_at
form_versions     id, form_id, version, status(draft|published),
                  form_schema_json, ui_schema_json, rules_schema_json,
                  components_json, content_hash, created_at, published_at
                  UNIQUE(form_id, version)
responses         id, form_id, version_id, answers_json, validation_json,
                  is_valid, created_at
```

The documents are stored as the exact JSON text that was compiled. Re-serializing
a parsed document rewrites number literals and can reorder keys, which changes the
content hash, so the bytes the core hashed are the bytes that are kept.

Published versions are immutable in the database, not only in the service: a
SQLite trigger rejects `UPDATE` and `DELETE` on a row whose status is
`published`. A published version is replaced by publishing a new draft cloned
from it.

## T3 consumption contract

The React app already has the runtime; what it lacks is a document that did not
come from `samples.ts`. T3 is the plumbing that makes a published definition
renderable, and it must not grow a second runtime.

### Client
A new definitions client beside the existing ones, talking to
`${API_BASE}/definitions` where `API_BASE` is the `VITE_API_BASE_URL ?? "/api"`
already used by `src/lib/http-colander-transport.ts`. It stays a separate surface
from `ColanderApi`, which is a source-neutral facade over the core's
computations: adding REST resources to it would drag database concerns into the
one abstraction that the direct-WASM source also implements.

### The route
`/forms/:formId` renders a published form. The chain reuses what the samples
already do:

1. `GET /definitions/:id/published` → the version with its four document strings
2. build a `CompileRequest` from those strings exactly as received
3. `api.compile` and `api.describeForm` through the existing source-neutral
   facade, so the page still works over HTTP or direct WASM
4. `createFormDefinitionFromCompiled` → `FormDefinition`
5. render the existing `FormRunner`

A form with no published version is a real state, not an error: the route says so
and links onward. It must never silently fall back to a sample, for the same
reason the API refuses an unknown id instead of substituting one.

### The document strings are the contract
The four documents arrive as JSON text and reach the core as text. Nothing in
this path parses and re-serialises a document: the content hash the database
stored was computed over those exact bytes.

## T5 wiring contract

The editor edits in memory. This piece is what makes the work worth keeping, and
it is where the drafts-and-publications contract meets the UI.

### The routes
- `/editor/new` stays: a blank document, and the only route that does not need a
  definition to exist.
- `/definitions` — the list: every definition, its version count, whether it is
  published, and a link to each one's editor and runtime.
- `/editor/$definitionId` — load, edit, save, publish.

### Load
`GET /definitions/:id/versions` for the version list, then
`GET /definitions/:id/versions/:versionId` for the one being edited. The four
documents arrive as text and go straight into the model's `parseDocuments`. The
version read also carries the `schemaCheck`, which is the editor's live
validation: it is the core's `compile` verdict on the stored text, and after a
save it is the core's verdict on what was just stored.

### Save
`serialiseDocuments` produces the four strings and they go to
`PATCH /definitions/:id/versions/:versionId`. A draft save is never gated by the
core — a draft may be invalid — so a save that the core dislikes is a save that
happened, followed by a `schemaCheck` that says so. A `409` here means the
version is published, and the editor offers the clone rather than editing in
place: that is the only way a published form ever changes.

### Publish
`POST /definitions/:id/versions/:versionId/publish`. The core rules, the server
publishes, the trigger freezes it, and the version is immutable from that point.
The editor must not offer "publish" on a version that is already published, and a
`400` from the core is shown with the core's own message, not paraphrased.

### Unsaved work
Until this piece the editor said "in memory only" and lost everything on reload,
which made losing it acceptable. It is not acceptable any more, so:
- a dirty state that says the document on screen differs from what is stored,
  decided by comparing the model's serialisation with the stored text rather
  than by a boolean someone has to remember to set,
- a `beforeunload` guard while dirty,
- and a visible path to the clone when a save is refused because the version is
  published.

### What this piece must not do
It must not add a second place that produces document text, and it must not
re-validate with a client-side guess of what the core would say. The core is the
authority and its answer is already in the response.

## T6 responses contract

The resource exists and is tested; nothing in the React app uses it yet. A
submitted response is stored with the core's own validation result **whether it
passed or not**, so this surface has something particular to show: a rejected
submission is a record, not a lost answer.

### Submit
- The runtime route gets a submit action that serialises the current answers
  **once**, through the same path the editor uses, and posts `{ formId, answersJson }`.
  Nothing re-serialises them on the way out: those bytes are what the core
  validated.
- The response comes back with the core's `ResponseValidation` and is shown as it
  is. **A validation failure does not block the record.** A person who answered
  a required question wrongly must still be able to find the submission they
  made, because that is how they fix it.
- A `409` on submit means the target is not published or does not belong to the
  form. That is a real state the user can act on, so say which one, using the
  code.

### List
- `/forms/:formId/responses` — that form's responses, newest first, each showing
  validity, when it was submitted, and how many errors the core reported. Do not
  show the stored `validationJson` raw; the list is a summary and the detail is a
  page.
- An empty list says so in the product's voice rather than rendering an empty
  table.

### Reopen
- One stored response, with its answers and the core's validation result, and the
  core's own error messages rendered where the field errors render at runtime. A
  submission is read-only: it is a record of what was answered, and reopening it
  must never look like a form you are about to submit.

### What this piece must not do
- It must not re-validate client-side. The stored validation is the core's, and a
  second opinion from the browser is a second answer.
- It must not store anything of its own. The answer lives in SQLite; the browser
  reads it.
- It must not show a response for a form whose id it did not receive. The list is
  scoped by the form in the route, not by anything the client remembers.

## Two content hashes, and why the page prints both

The runtime route prints two values next to a published form, and they are not
the same thing:

- **the stored document hash** — computed by the core over the document text as
  received, over `formSchemaJson` + `uiSchemaJson` + `rulesSchemaJson` together.
  This is the one the database holds, and it changes if the stored text changes.
- **the compiled hash** — computed by the core over the compiled artifact. It is
  the identity of the compiled form, not of the stored bytes.

Printing only the compiled one under the label "content hash" made the page
disagree with the API about a number whose whole purpose is to prove the stored
bytes did not move. Both are printed, named for what they are.

Recomputing the stored hash from the stored text returns the stored hash, and
the stored text is byte-identical to what the client sent. That round trip is
the property the whole never-re-serialise rule exists to protect, and it is
verified rather than assumed.

## Acceptance evidence

- [ ] `npx tsc -b` clean in `examples/nest-app` and `examples/react-app`.
- [ ] `npx vitest run` green in `examples/nest-app` (new repository and e2e
      specs included) and no new failure in `examples/react-app`.
- [x] The first half of this, the API half, is verified: a definition is created
      through the resource API, published, stored and rendered by the runtime
      route. The editor half needs T4.
- [ ] A form authored in the editor compiles, publishes, is listed, is consumed
      by the runtime route, and a submitted response is stored with its
      validation result and can be listed again.

## Blocking facts

- `cloneLatestAsDraft` on the repository has no caller: the clone route copies the
  requested version instead, because the route names a `versionId` and that method
  always copies the highest one.
- RESOLVED. The app owns its own path: `main.ts` calls
  `app.setGlobalPrefix("api")` and the react dev proxy no longer strips the
  prefix, so `/api/definitions` answers 200 directly *and* through the proxy, and
  the e2e specs, which mount the app with the same prefix, test the real boot
  configuration. 24 unit and 19 e2e green. The half-applied state between the two
  halves briefly 404'd every browser request to the API, which is why the two
  halves have to land together.
- FIXED. `vp fmt --check` never worked for `examples/`: vite-plus resolves its
  targets through git, so a gitignored directory produced "Expected at least one
  target file" and looked exactly like a broken tool. It works now, and every file
  in this feature has been formatted by it.
- OPEN, and found by a delegated writer: `tsc -b` builds `tsconfig.json`, which
  covers `src/**` only, in every package. `tsconfig.test.json` is not part of the
  required verification and is already red on the base with ten pre-existing
  errors, so **a type-level assertion in a test file is enforced by nothing**.
  Type-level proofs have to live in a `src/` file until that gap is closed. Two
  build-enforced checks already depend on that fact and would silently stop being
  checks if the test tree were type-checked and the `src` copies drifted.
- OPEN: `vp fmt` resolves its scope from the package whose config it finds, so a
  run in `packages/colander-compiler` does not cover `examples/react-app`. A
  change spanning packages has to be formatted once per package, and "fmt is
  clean" from one directory is not a statement about the other.
- OPEN: the running app's HTTP path was briefly broken by the half-applied prefix
  migration (backend serving `/api` while the proxy still stripped it). Both
  halves are now in place and `/api/definitions` answers 200 through the proxy and
  directly. Recorded because it is the kind of half-change that silently breaks
  three downstream tasks at once.

- RESOLVED. `examples/` and `odd/` are versioned again; the databases under
  `examples/*/data/` are the local state that stays ignored.
- FIXED. The `wasm-colander-transport.test.ts > does not cache a core after a real panic`
  failure is fixed, and it was a real defect rather than a stale test: a panicked
  core was cached forever because `load()` in `packages/colander-browser` was
  `async`, so the identity check that evicts it could never match. Both suites
  are fully green.
