# @ailuracode/colander

The TypeScript binding for **colander**, the form core written in Rust and compiled to WebAssembly.

```ts
import { colander } from "@ailuracode/colander";

const core = await colander.load();

const compiled = core.compile({ formSchemaJson });
console.log(compiled.contentHash);
```

The package is a boundary, not a reimplementation: it marshals requests, turns the ABI's failure
envelope into a `ColanderError`, and hands back ordinary objects. Everything the core computes lives
in `colander`.

The core is the published Rust crate [`colander@0.1.0`](https://crates.io/crates/colander/0.1.0),
compiled to an import-free WebAssembly module. This package ships `wasm/colander.wasm` and does
**not** depend on a separate WebAssembly npm package.

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

## Install

The package metadata is named `@ailuracode/colander`. This workspace does not assume that the
package is already present in a registry. To install a local checkout, build the library with Vite+
and create the package archive:

```bash
pnpm exec vp pack
pnpm pack
pnpm add ./ailuracode-colander-0.1.0.tgz
```

Once published, the same package can be installed by name:

```bash
pnpm add @ailuracode/colander
```

Node 20 or newer is required. The package has no runtime dependencies; the artifact is plain data
with no install step.

## Toolchain

The repository-local Vite+ toolchain is pinned to `vite-plus@1.0.0-rc.0`. pnpm remains the package
manager and the explicit TypeScript command remains available for consumer-facing type checks; Vite+
owns formatting, linting, type-aware checking, tests, task execution, and library packaging.

```bash
pnpm exec vp check --fix
pnpm exec vp check
pnpm exec vp lint
pnpm exec vp fmt
pnpm exec vp fmt --check
pnpm typecheck
pnpm exec vp test
pnpm exec vp pack
```

Tests import their runner from `vite-plus/test`. The root `vite.config.ts` keeps the complete Oxlint
category/plugin set enabled with denied warnings, zero warning budget, unused-suppression reporting,
and type-aware lint/type checking.

## Quick start

```ts
import { colander } from "@ailuracode/colander";

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
  console.log(check.message);
}
```

colander ships no schemas: `schemas` carries the text of whichever ones the call needs, named after
the document each one validates — `formSchema`, `uiSchema` and `rulesSchema` for `kind: "form"`, and
`workflowSchema` for `kind: "workflow"`. `kind` is `"form"` (the default), `"component"`,
`"workflow"` or `"instance"`; the `"instance"` case needs no `schemas` entry, takes `schemaJson` and
`instanceJson`, and lets `label` name the document in error messages (default `"instance"`). This is
the only method that does not throw on a bad document, because "invalid" is a validator's ordinary
answer — but a trap still throws, since a bug in the core is not an opinion about your document.

For `kind: "form"` this also runs the rule dependency check, the only place the `RULE_*` codes
surface.

### `contentHash` — hash a triple with no compilation

```ts
const digest = core.contentHash({ formSchemaJson, uiSchemaJson, rulesSchemaJson });
```

Pinned byte for byte to a canonical serialization: key order, escaping and number literals all feed
the digest. Whitespace does not; key order does.

### `nextVersion` — the next patch above everything published

```ts
const next = core.nextVersion({ published: ["1.10.0", "1.9.9"] });
// "1.10.1"
```

The parser is deliberately permissive and is **not** semver-strict: `1..0.0` and `01.0.0` are
accepted, `1.0.0-beta` is rejected. With nothing published — `published` absent or not an array —
the answer is `"1.0.0"`.

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
import { ColanderError, colander } from "@ailuracode/colander";

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

| `kind`              | means                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `"invalid_request"` | The envelope was unusable — a bug in this binding, not in your data, because the binding builds the envelope. |
| `"validation"`      | The core read the request and rejected the payload. The ordinary "no".                                        |
| `"panic"`           | A bug in the core. The message carries the panic text.                                                        |

**Message wording is not part of the contract.** It is colander's own and may change; match on
`kind`, or on the `code` of a `ValidationError`/`ResponseError`, never on the text.

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

## Building the WebAssembly artifact

Install Rust, the target, and the repository's pinned pnpm dependencies once:

```bash
pnpm install
rustup target add wasm32-unknown-unknown
```

Then run the standard-library-only build script:

```bash
pnpm exec vpr build:wasm
```

The script downloads the exact `colander` 0.1.0 archive from crates.io and verifies this SHA-256
before inspecting or extracting it:

```text
315c951f0b0e865a00b5a3eaa5e5caf1a5a4fdf41de387d8253cb3d3df9ab2ea
```

It uses the npm `tar` development dependency for a non-writing archive validation pass and a
filtered extraction rooted in a fresh temporary directory. It then builds `wasm32-unknown-unknown`
in release mode, validates that the module has no imports and exposes the documented `colander_*`
ABI, and copies only `colander.wasm` into this package. The temporary directory is always removed.
The published crate and source are available at the
[crates.io listing](https://crates.io/crates/colander/0.1.0) and
[GitHub repository](https://github.com/ailuracollective/colander).

The checked-in artifact is 1,494,683 bytes with SHA-256
`f82c4d7bc749be8e584bd98540557937f2770b9cf780921334808825effb5d7c`.

## Tests and packaging

Use `vpr` for project-defined workflows. It runs the scripts in `package.json` through Vite+, while
`vp check`, `vp fmt`, `vp test`, and `vp pack` remain the underlying built-in commands.

```bash
pnpm exec vpr build:wasm
pnpm exec vpr check
pnpm exec vpr fmt:check
pnpm exec vpr typecheck
pnpm exec vpr test
pnpm exec vpr pack
```

`test/vectors.test.ts` replays the frozen vectors from a sibling `colander` checkout when it is
available. Set `COLANDER_VECTORS` to point at its `tests/golden/vectors/` directory when the
checkout is elsewhere; the vector group skips if no directory is found.

`test/binding.test.ts` covers the boundary: JSON escaping, heap growth, buffer release, typed
envelopes, and WebAssembly trap retirement. `vpr pack` emits ESM JavaScript, declarations, and
source maps under `dist/`; the public `dist/index.js` keeps the relative `../wasm/colander.wasm`
URL.

## Why WebAssembly

The core is a pure function library with no I/O, state or async work, so it compiles to a module
with **zero imports**. One artifact works across browser, Node, Deno, Bun and Workers without a
platform-specific native binary or an install-time build.
