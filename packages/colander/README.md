# @ailura/colander

The TypeScript binding for **colander**, the form core written in Rust and compiled to WebAssembly.

This is the publishable package in the `colander-monorepo` pnpm workspace. Workspace-level
orchestration lives at the repository root; package commands and the public package contract live
here.

```ts
import { colander } from "@ailura/colander";

const core = await colander.load();

const compiled = core.compile({ formSchemaJson });
console.log(compiled.contentHash);
```

The package is a boundary, not a reimplementation: it marshals requests, turns the ABI's failure
envelope into a `ColanderError`, and hands back ordinary objects. Everything the core computes lives
in `colander`.

The core is the Rust crate `colander` from the sibling repository, compiled to an import-free
WebAssembly module. The `versionInfo` the loaded module reports is pinned by `corpus.lock.json` and
asserted in `test/contract-corpus.test.ts`, so a rebuilt binary cannot drift from the recorded
provenance unnoticed. This package ships `wasm/colander.wasm` and does **not** depend on a separate
WebAssembly npm package.

## Contents

- [Install](#install)
- [Toolchain](#toolchain)
- [Quick start](#quick-start)
- [The six operations](#the-six-operations)
- [Two conventions that are easy to get wrong](#two-conventions-that-are-easy-to-get-wrong)
- [Failures](#failures)
- [Loading the module yourself](#loading-the-module-yourself)
- [Building the WebAssembly artifact](#building-the-webassembly-artifact)
- [Tests and packaging](#tests-and-packaging)
- [Why WebAssembly](#why-webassembly)

## Install and package

The package is published as `@ailura/colander`. From the repository root, the ordinary offline path
builds declarations and creates the current archive without rebuilding WASM. It uses the checked-in
`wasm/colander.wasm` package input:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run audit
```

`pnpm run audit` is the pre-publication gate. It checks that every export-map target exists and is
covered by `files`, that the WebAssembly asset ships, and that npm agrees about what it would
include (`npm pack --dry-run --json`). **This package produces no `.tgz`**: `npm publish` builds the
archive from the package directory, so there is no local artifact to build or keep in sync. A
consumer installs the published package by name after release, or links this directory with `link:`
— which resolves through the same `exports` map to the same `dist`.

The package has no runtime dependencies; the WebAssembly file is plain package data. The runtime
contract is Node `>=20.19.0`. The workspace development contract is pnpm `12.3.4`, Vite+
`1.0.0-rc.0` (Vite 8 / Vitest 5), and TypeScript 5.9.

## Toolchain

The package-local Vite+ configuration owns formatting, linting, type-aware checks, tests, and
library packaging. The root workspace matrix runs the same required capabilities for all three
publishable packages and fails when a package script is absent.

Useful focused commands from the repository root are:

```bash
pnpm --filter @ailura/colander run build
pnpm --filter @ailura/colander run check
pnpm --filter @ailura/colander run fmt:check
pnpm --filter @ailura/colander run typecheck
pnpm --filter @ailura/colander run test:unit
pnpm --filter @ailura/colander run test:contract
```

`test:unit` is the normal binding-boundary suite. `test:contract` uses the checked-in frozen corpus
under `test/fixtures/contract-vectors/colander-0.1.0/` and verifies its adjacent `corpus.lock.json`
before Vitest starts. The lock records the source commit/describe, five file digests, replay counts,
and explicit ABI-boundary exclusions. A missing, malformed, non-array, digest-mismatched, or stale
corpus fails with an actionable path. `COLANDER_VECTORS` is only an explicit override; its
`corpus.lock.json` must be in the override directory, and no parent or sibling lock is searched.
Refresh the corpus only with an explicit core/corpus version decision, copying files without record
transformations and updating the lock before running the contract command.

## Quick start

```ts
import { colander } from "@ailura/colander";

const core = await colander.load();

const compiled = core.compile({ formSchemaJson });
// → { formSchemaJson, uiSchemaJson, rulesSchemaJson, dependencyMetadataJson, contentHash }

const state = core.evaluateRules({
  formSchemaJson: compiled.formSchemaJson,
  rulesSchemaJson: compiled.rulesSchemaJson!,
  values: { "patient.weight": 70 },
});
// → { visibility, enabled, required, calculatedValues, validationErrors }

const outcome = core.validateResponse({
  formSchemaJson: compiled.formSchemaJson,
  answersJson: JSON.stringify(answers),
  mode: "Complete",
});
// → { normalizedAnswersJson, errors, isValid }
```

The public loader is the lowercase `colander` object. There is no compatibility class or alias.

## The six operations

Every entry point takes a request object and returns a result object. The ABI has eleven symbols;
six of them are whole operations, and the rest are covered below.

### `compile` — expand, canonicalize, hash

```ts
const compiled = core.compile({
  formSchemaJson,
  uiSchemaJson, // optional
  rulesSchemaJson, // optional
  // Optional, and the interesting part: the caller supplies the component versions.
  components: [
    {
      code: "patient-demographics",
      version: "1.0.0",
      formSchemaJson: componentFormJson,
      uiSchemaJson: componentUiJson,
    },
  ],
});
```

There is **no component repository**. Elsewhere the compiler reads published component versions from
storage; here the caller hands them in and the core expands the `component-ref` fields from that
set. It keeps the core pure — no I/O, no callbacks — and it means "published" is whatever the caller
decided to pass.

`compiled.contentHash` is what identifies the form version. It is a SHA-256 over the compiled
triple, and two forms hash the same exactly when they compile to the same documents.

### `evaluateRules` — the live-form call

```ts
const evaluated = core.evaluateRules({
  formSchemaJson: compiled.formSchemaJson,
  rulesSchemaJson: compiled.rulesSchemaJson!,
  uiSchemaJson: compiled.uiSchemaJson ?? undefined,
  values: { "patient.weight": 70 }, // keyed by field code
});

for (const [fieldId, visible] of Object.entries(evaluated.visibility)) {
  // …
}
```

Call this on every keystroke: it answers which fields are visible, enabled and required, and what
the calculated fields work out to. It does **not** validate — that is `validateResponse`. Every
field appears in the three boolean maps, whether or not it has a rule.

### `validateResponse` — the acceptance call

```ts
const validation = core.validateResponse({
  formSchemaJson: compiled.formSchemaJson,
  rulesSchemaJson: compiled.rulesSchemaJson ?? undefined,
  answersJson,
  mode: "Complete",
});

if (!validation.isValid) {
  for (const error of validation.errors) {
    console.log(`${error.path}: ${error.message}`);
  }
}
```

A rejected answer is **not** an exception. `validation.errors` is the answer, `isValid` is the
shortcut, and `normalizedAnswersJson` is the values that were accepted, converted to their declared
types. `mode` is `"Draft"` (the default) or `"Complete"`; absent or blank `rulesSchemaJson` means
"no rules", which cannot raise a version mismatch.

An `error.path` is a JSON pointer to the field's location **in the form schema**, not in the
answers. Two exceptions: an unknown answer key reports `/answers/<key>`, and a failed cross-field
validation reports `/rules/validations`.

### `validateSchema` — the one method that answers instead of throwing

```ts
const check = core.validateSchema({
  kind: "form",
  formSchemaJson,
  uiSchemaJson,
  rulesSchemaJson,
  schemas: { formSchema: formJsonSchemaText },
});

if (!check.valid) {
  // `code` is the core's SCREAMING_SNAKE code, empty when the message opens with prose.
  console.log(check.code, check.message);
}
```

colander ships no schemas: `schemas` carries the text of whichever ones the call needs, named after
the document each one validates — `formSchema`, `uiSchema` and `rulesSchema` for `kind: "form"`, and
`workflowSchema` for `kind: "workflow"`. `kind` is `"form"` (the default), `"component"`,
`"workflow"` or `"instance"`; the `"instance"` case needs no `schemas` entry, takes `schemaJson` and
`instanceJson`, and lets `label` name the document in error messages (default `"instance"`). Only an
ordinary `validation` result becomes `{ valid: false }`; typed `invalid_request` and `panic`
failures remain `ColanderError`s, because a binding or core failure is not an opinion about the
submitted document.

For `kind: "form"` this also runs the rule dependency check, the only place the `RULE_*` codes
surface. For `kind: "workflow"` the core **rejects** a `published` key outright, so the request type
does not offer one: an accepted key that nothing reads is a trap, and the core retired it.

### `contentHash` — hash a triple with no compilation

```ts
const digest = core.contentHash({ formSchemaJson, uiSchemaJson, rulesSchemaJson });
```

Pinned byte for byte to a canonical serialization: key order, escaping and number literals all feed
the digest. Whitespace does not; key order does.

### `nextVersion` — the next version above everything published

```ts
const published = ["1.2.3", "1.10.0", "1.9.9"];

core.nextVersion({ published });
// "1.10.1"  — the default bump is "patch"
core.nextVersion({ published, bump: "minor" });
// "1.11.0"
core.nextVersion({ published, bump: "major" });
// "2.0.0"
```

The parser is **strict**, not permissive: exactly three ASCII-digit segments, no leading zero, no
pre-release and no build metadata. `1..0.0`, `01.0.0`, `1.0` and `1.0.0-beta` are each rejected with
a `ColanderError` whose `code` is `INVALID_SEMVER`, and one bad entry fails the whole call. With
nothing published — `published` absent or empty — the answer is `"1.0.0"`. `bump` accepts `"patch"`,
`"minor"` and `"major"`; anything else is rejected.

### The rest of the ABI

```ts
core.versionInfo(); // { name, version, abi }
core.abiVersion; // 1
```

The module exports eleven symbols. The binding drives `colander_alloc`, `colander_free_buffer` and
`colander_free_string` internally: the host has no allocator for the guest's heap, so the guest
hands one out and the host copies the request into linear memory by hand. Those three are **not**
part of the public API; the JSON entry points, `versionInfo` and the `abiVersion` property are. A
module that does not expose the documented ABI is rejected at load time rather than failing on the
first call.

A request is capped at `COLANDER_MAX_REQUEST_BYTES` (64 MiB), the core's own bound. The binding
checks it before the bytes reach linear memory and refuses an over-cap request with the core's
`kind` and its `REQUEST_TOO_LARGE` code, so a caller that respects the cap cannot tell the two
refusals apart:

```ts
import { COLANDER_MAX_REQUEST_BYTES } from "@ailura/colander";
```

The exported `FieldType` union is the closed set of the twelve field type names a document may
declare — `text`, `textarea`, `number`, `integer`, `boolean`, `date`, `datetime`, `time`, `choice`,
`group`, `repeater` and `component-ref`. There are no aliases: `email`, `bool`, `dropdown` and
`section` are not field types, and a caller using those names converts them first.

## Two conventions that are easy to get wrong

**Documents travel as JSON text.** Every `…Json` field is a `string` holding JSON, not a parsed
object. The core preserves number literals and the content hash covers the bytes, so round-tripping
a document through `JSON.parse`/`JSON.stringify` on the way in is usually a bug: `1.50` becomes
`1.5` and key order can change, and the hash moves.

**Field ids and field codes are different keys.** The rule evaluation says so:

| what                                | keyed by       |
| ----------------------------------- | -------------- |
| `values` you pass in                | field **code** |
| `calculatedValues`                  | field **code** |
| `visibility`, `enabled`, `required` | field **id**   |

If a map comes back empty, this is almost always why.

## Failures

Every method except `validateSchema` throws `ColanderError` when the core returns a failure
envelope:

```ts
import { ColanderError, colander } from "@ailura/colander";

try {
  const core = await colander.load();
  core.compile({ formSchemaJson });
} catch (error) {
  if (error instanceof ColanderError && error.kind === "validation") {
    // The core read the request and said no. The message is meant for whoever
    // filled the form in.
  }
}
```

| `kind`              | means                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `"invalid_request"` | The envelope was unusable — a bug in this binding, or a request over `COLANDER_MAX_REQUEST_BYTES`, not in your data. |
| `"validation"`      | The core read the request and rejected the payload. The ordinary "no".                                               |
| `"panic"`           | A bug in the core. The message carries the panic text.                                                               |

`code` is the branchable part. The core's envelope carries `kind` and `message`, and the message
opens with a `SCREAMING_SNAKE` code — `REQUEST_TOO_LARGE`, `INVALID_SEMVER`, `RULE_UNKNOWN_CODE`,
`FIELD_*`, `COMPONENT_*` and so on. The binding lifts that prefix onto `error.code` so a caller can
branch on it:

```ts
try {
  core.validateResponse(request);
} catch (error) {
  if (error instanceof ColanderError && error.code === "REQUEST_TOO_LARGE") {
    // The document is too large for the core to read.
  }
}
```

`code` is an empty string when the message opens with prose, which several core messages do:
`"'formSchemaJson' is required and must be a string."` carries no code. `validateSchema` reports the
same code on its `{ valid: false }` branch.

**Message wording is not part of the contract.** It is colander's own and may change; match on
`kind`, on `ColanderError.code`, or on the `code` of a `ValidationError`/`ResponseError`, never on
the text.

A caught Rust panic is returned as a normal typed error envelope. A real WebAssembly trap is
different: it bypasses the envelope, and the binding reports the host trap text, retires that
instance, and rejects later calls. Load a fresh instance after a trap:

```ts
let core = await colander.load();
try {
  core.evaluateRules(request);
} catch (error) {
  if (error instanceof ColanderError && error.kind === "panic") {
    core = await colander.load();
  }
}
```

## Loading the module yourself

`colander.load()` reads the bundled `wasm/colander.wasm` through
`new URL("../wasm/colander.wasm", import.meta.url)`. It reads from disk under Node and uses `fetch`
elsewhere, so the same package works in browsers and Workers. To control the bytes instead:

```ts
const core = await colander.load(bytes); // ArrayBuffer or Uint8Array
const compiledCore = await colander.load(await WebAssembly.compile(bytes));
```

Pass a `WebAssembly.Module` to skip compilation on every load. This is useful in a Worker or under a
CSP that disallows `WebAssembly.compile`.

### `COLANDER_WASM_PATH` — load the engine from somewhere else

Under Node the packaged asset is the default, and one variable replaces it. The value is a
filesystem path, absolute or relative to `process.cwd()`. There is no `file:` URL form, no http(s)
URL, and no list of candidates to try in order.

| Variable             | Default                                           | Scope                                                                 |
| -------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `COLANDER_WASM_PATH` | Unset, which is the packaged `wasm/colander.wasm` | Node only. Browsers and Workers ignore it and use the packaged asset. |

An unset or blank value means the packaged asset. A value that cannot be read is an error naming
both the resolved absolute path and the variable, because a load that quietly fell back would run an
engine nobody asked for and hide the mistake.

Precedence is explicit bytes first:

```text
colander.load(source) > COLANDER_WASM_PATH > packaged wasm/colander.wasm
```

### A linked package and a dev server that refuses to serve it

The asset URL is derived from `import.meta.url`, so it follows the package wherever it is installed.
A production build is unaffected: the bundler emits the `.wasm` as an asset and rewrites the URL. A
**dev server** is a different matter, and this is the one requirement a linked package creates.

If the package is linked from a directory outside your app's root — a monorepo, a sibling checkout,
a `link:` dependency — the dev server resolves the symlink and then refuses to serve a file from
outside its root. Vite answers `403 Forbidden` and the failure looks like a network problem:

```text
could not load /@fs/absolute/path/to/packages/colander/wasm/colander.wasm: 403 Forbidden
```

Allow the package directory:

```ts
// vite.config.ts
server: {
  fs: {
    allow: [path.resolve(import.meta.dirname, "../..")];
  }
}
```

The same applies to any dev server with a filesystem allowlist. When the package comes from the
registry instead, the path is already inside `node_modules` and nothing is needed.

## Building the WebAssembly artifact

Install Rust, the target, and the repository's pinned pnpm dependencies once:

```bash
pnpm install
rustup target add wasm32-unknown-unknown
```

Then run the standard-library-only build script through the package filter:

```bash
pnpm --filter @ailura/colander run build:wasm
```

`build:wasm` needs to know where the engine comes from, and it will not guess. Set
`COLANDER_WASM_SOURCE` to one of three origins:

| Origin                                   | What it does                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `path:<file.wasm>`                       | Copies a ready module. Offline, and the fastest path when a build already produced one.  |
| `path:<crate-directory>`                 | Compiles the crate with `cargo build --release --target wasm32-unknown-unknown`.         |
| `git:<repository>@<commit\|tag\|branch>` | Exports that revision read-only with `git archive`, then compiles the crate at its root. |
| `github:<owner>/<repo>@<tag>[!<asset>]`  | Downloads a prebuilt release asset. No Rust toolchain needed.                            |

```bash
# the sibling checkout on this machine, at one commit
COLANDER_WASM_SOURCE="git:../colander@d54a86e" pnpm --filter @ailura/colander run build:wasm

# an already-compiled module
COLANDER_WASM_SOURCE="path:../colander/target/wasm32-unknown-unknown/release/colander.wasm" \
  pnpm --filter @ailura/colander run build:wasm
```

There is deliberately **no default origin and no crates.io origin**. `colander` has no published
crate, and the `v1.0.0` GitHub release ships only `libcolander.so`, so neither remote origin can
supply a WebAssembly engine: a `github:` origin asking for `colander.wasm` answers `404`. Rather
than keep a download-and-unpack path for an artifact that cannot be fetched, the build refuses to
start and names the origins it does support.

Whatever the origin, the build resolves it, verifies `COLANDER_WASM_SHA256` when one is set, checks
that the module exports the eleven documented `colander_*` symbols, and only then writes
`wasm/colander.wasm`. A failed digest or a module with the wrong surface leaves the checked-in
artifact untouched. `--require-digest` (used by `release:pack`) makes the digest mandatory, because
a release artifact has to be pinned to bytes someone verified.

The commit the checked-in artifact was built from is recorded in
`test/fixtures/contract-vectors/colander-0.1.0/corpus.lock.json` under `source`, including any
uncommitted patch it carries.

The checked-in workspace artifact used by local packaging is 1,848,089 bytes with SHA-256
`659ae04ac004546a82d14daf10364b7c14759aa7e5b4496bf9f84ba230139712`. It is package input, not an
ignored generated file. It is built from `colander` `v1.0.0` plus the D-4 nesting fix described in
`source.localPatches` of the corpus lock. The release owner may replace it through the explicit
`pnpm run release:pack` rebuild, then must verify the artifact and final archive before publication.

## Tests and packaging

The package separates fast unit/boundary tests from the checked-in frozen-vector contract:

```bash
pnpm --filter @ailura/colander run check
pnpm --filter @ailura/colander run fmt:check
pnpm --filter @ailura/colander run typecheck
pnpm --filter @ailura/colander run test:unit
pnpm --filter @ailura/colander run test:contract
pnpm --filter @ailura/colander run audit
```

`test:unit` covers JSON escaping, heap growth, buffer release, typed envelopes, schema-error
classification, explicit Node/browser WASM loading, and WebAssembly trap retirement. `test:contract`
replays the checked-in corpus from `test/fixtures/contract-vectors/colander-0.1.0/` after verifying
its adjacent `corpus.lock.json`, file digests, replay inventory, and explicit ABI-boundary
exclusions. Missing, malformed, non-array, or mismatched vectors fail the contract command with an
actionable message. `COLANDER_VECTORS` is only an explicit override; its `corpus.lock.json` must be
in the override directory, and no parent or sibling lock is searched.

`pnpm run audit` validates every export-map target against the manifest's `files` list and the
WebAssembly asset, without producing an archive; it is part of `pnpm run check`. `pnpm run pack` is
the publish step: the package `prepack` lifecycle removes only generated `dist` before rebuilding
it, and the produced archive is verified before the stable local alias is written. `dist/` contains
ESM JavaScript, declarations, and source maps, and the public `dist/index.js` keeps the relative
`../wasm/colander.wasm` URL. `pnpm run release:pack` is the explicit network-backed WASM rebuild
path.

Nothing in the build, test, or verification loop installs a tarball. The examples link the packages
by directory and resolve them through their own `exports`, so they exercise `dist` without a `.tgz`
in the way; an archive is produced only when publishing, because a tarball is the npm registry's
format rather than a choice this repository makes.

## Why WebAssembly

The core is a pure function library with no I/O, state or async work, so it compiles to a module
with **zero imports**. One artifact works across browser, Node, Deno, Bun and Workers without a
platform-specific native binary or an install-time build.

## License limitation

The manifest retains its existing MIT declaration. This checkout has no approved license file to
copy into the archive; the release owner must add the repository-approved license text before
publication.
