# NestJS 12 example: colander over WebAssembly

A NestJS 12 application that consumes the packed `@ailura/colander` archive and drives the
Rust/WebAssembly form core through Nest's dependency injection. Nothing about the core is mocked:
the app loads `wasm/colander.wasm` at boot and every endpoint returns a value the WebAssembly module
computed.

## What this proves

- An ESM-only package resolves inside a Nest 12 application with a plain static import and **no
  interop shim**.
- One asynchronous provider loads the core once per process, and the rest of the app reaches it
  through a symbol injection token.
- A `ColanderError` maps onto HTTP through an exception filter: only `validation` is a 400.
- The example installs from its own workspace root, so the library's lockfile and checks stay
  untouched.

## Prerequisites

- Node `>=20.19.0` at runtime; the workspace development toolchain is Node
  `^22.18.0 || ^24.11.0 || >=26.0.0`.
- pnpm `12.3.4`.
- The current local core archive. It is gitignored, so build it from the repository root with the
  ordinary offline package flow:

  ```bash
  pnpm install --frozen-lockfile
  pnpm run pack
  # produces the versioned archive and stable local alias at the repository root
  # (ailura-colander-0.1.0.tgz and ailura-colander.tgz)
  ```

`pnpm run release:pack` is separate and rebuilds WASM from the Rust crate; it is not needed for this
example.

## Install and verify

The root `pnpm run bootstrap` command performs this example's offline frozen install, package
identity check, build, unit tests, and end-to-end tests. The manual equivalent is:

```bash
pnpm --dir examples/nest-app install --offline --frozen-lockfile
pnpm --dir examples/nest-app run build
pnpm --dir examples/nest-app run test
pnpm --dir examples/nest-app run test:e2e
```

The example has its own `pnpm-workspace.yaml` (`packages: ["."]`), so its install never edits the
library workspace or lockfile. `@ailura/colander` resolves from the stable local archive
`file:../../ailura-colander.tgz`; the lockfile records the archive digest.

## Run

```bash
pnpm start                      # nest start (compiles and runs)
pnpm start:dev                  # watch mode
pnpm build && node dist/main.js # production build
PORT=3000 node dist/main.js     # pick a port
```

At boot the app resolves the core and logs `[Bootstrap] colander colander@0.1.0 (ABI 1) loaded` —
that line is proof the WebAssembly artifact loaded, not only the Nest container.

## Endpoints

| Method | Path                       | Body                      |
| ------ | -------------------------- | ------------------------- |
| GET    | `/forms/core`              | —                         |
| POST   | `/forms/compile`           | `CompileRequest`          |
| POST   | `/forms/content-hash`      | `ContentHashRequest`      |
| POST   | `/forms/evaluate-rules`    | `EvaluateRulesRequest`    |
| POST   | `/forms/validate-response` | `ValidateResponseRequest` |
| POST   | `/forms/validate-schema`   | `ValidateSchemaRequest`   |
| POST   | `/forms/next-version`      | `NextVersionRequest`      |

Every route returns HTTP 200, including the POSTs: each one is a computation, not a resource
creation.

### Curl each route

Run from `examples/nest-app` against a server on port 3000. The two variables build the request
bodies from the fixtures so the JSON text is never re-parsed.

```bash
BMI=$(node -e "const f=require('./test/fixtures/bmi-calculation.json');process.stdout.write(JSON.stringify({formSchemaJson:JSON.stringify(f.form),rulesSchemaJson:JSON.stringify(f.rules)}))")

# GET /forms/core
curl -s localhost:3000/forms/core

# POST /forms/compile -> the golden content hash
curl -s -X POST localhost:3000/forms/compile \
  -H 'content-type: application/json' -d "$BMI"

# POST /forms/content-hash
curl -s -X POST localhost:3000/forms/content-hash \
  -H 'content-type: application/json' -d "$BMI"

# POST /forms/evaluate-rules -> body.bmi 22.86, keyed by field code
curl -s -X POST localhost:3000/forms/evaluate-rules \
  -H 'content-type: application/json' \
  -d "$(node -e "const f=require('./test/fixtures/bmi-calculation.json');process.stdout.write(JSON.stringify({formSchemaJson:JSON.stringify(f.form),rulesSchemaJson:JSON.stringify(f.rules),values:{'body.weight.kg':70,'body.height.m':1.75}}))")"

# POST /forms/validate-response -> isValid false (Complete rejects the BP pair)
curl -s -X POST localhost:3000/forms/validate-response \
  -H 'content-type: application/json' \
  -d "$(node -e "const f=require('./test/fixtures/bp-cross-field.json');process.stdout.write(JSON.stringify({formSchemaJson:JSON.stringify(f.form),rulesSchemaJson:JSON.stringify(f.rules),answersJson:JSON.stringify({'vital.bp.systolic':120,'vital.bp.diastolic':130}),mode:'Complete'}))")"

# POST /forms/validate-schema -> an instance check needs no external schema
curl -s -X POST localhost:3000/forms/validate-schema \
  -H 'content-type: application/json' \
  -d '{"kind":"instance","schemaJson":"{\"type\":\"object\",\"required\":[\"name\"]}","instanceJson":"{\"name\":\"Ada\"}"}'

# POST /forms/next-version -> 1.0.1
curl -s -X POST localhost:3000/forms/next-version \
  -H 'content-type: application/json' -d '{"published":["1.0.0"]}'
```

## Tests

```bash
pnpm test      # unit: boots the real ColanderModule, asserts fixture facts
pnpm test:e2e  # end-to-end: supertest against the real AppModule
pnpm lint
pnpm build
```

The unit spec loads the actual WebAssembly core with
`Test.createTestingModule({ imports: [ColanderModule] })` and checks the golden content hash, the
BMI calculation, `nextVersion`, the cross-field validation code, and the Draft-versus-Complete
difference.

## Three notes that are easy to get wrong

**1. Nest 12 is ESM, so a static import is enough.** The scaffold sets `"type": "module"`,
`module: "nodenext"`, and uses top-level `await`. `@ailura/colander` is ESM-only, and a static
`import { colander } from '@ailura/colander'` resolves it natively — no interop shim, no
`createRequire`. A dynamic `await import(...)` is only needed when a CommonJS consumer requires an
ESM module.

**2. Documents travel as JSON text.** Every `…Json` field is a `string` holding JSON, never a parsed
object. Re-serializing a parsed document on the way in rewrites number literals and can reorder
keys, and the content hash covers the bytes. The fixtures are read as text and stringified exactly
once.

**3. Field ids and field codes are different keys.** In rule evaluation:

| what                                | keyed by       |
| ----------------------------------- | -------------- |
| `values` you pass in                | field **code** |
| `calculatedValues`                  | field **code** |
| `visibility`, `enabled`, `required` | field **id**   |

The BMI fixture makes this visible: `calculatedValues["body.bmi"]` is the code, and `enabled["bmi"]`
is the id.

## Why its own workspace

The example owns its pnpm workspace root on purpose. Installing it as a member of the library
workspace would pull example-only dependencies into the library's lockfile and subject the library's
format and lint gates to scaffolded code. Keeping it nested means `pnpm install` here is local to
`examples/nest-app`.
