# @ailura/colander-browser

`@ailura/colander-browser` is the canonical browser lifecycle adapter for the packed Colander core.
It owns lazy loading, shared concurrent loads, retry after a failed load, and recovery after a real
core panic. The core operations and WebAssembly implementation remain in `@ailura/colander`.

## Public API

```ts
import { createWebColander } from "@ailura/colander-browser";

const client = createWebColander();
const info = await client.getCore();
const compiled = await client.compile({ formSchemaJson });
```

The client exposes readonly async operations, one per core entry point:

- `getCore()` — `abiVersion` and `versionInfo`
- `compile(request)`
- `describeForm(request)`
- `contentHash(request)`
- `evaluateRules(request)`
- `validateResponse(request)`
- `validateSchema(request)`
- `nextVersion(request?)` — takes `published` and `bump`

`WebColanderClient`, `WebColanderOptions`, `WebColanderLoader`, every core request and result type
(including `DescribeFormRequest`, `DescribedForm`, `DescribedField`, `FieldType`, `SchemaResult` and
`VersionBump`), `WasmSource`, the loader-boundary types, and the core constants
`COLANDER_ABI_VERSION` and `COLANDER_MAX_REQUEST_BYTES` are exported, so a consumer of this package
can name anything a call returns without reaching for the core package directly.

`ColanderWebError` remains a compatibility name for unavailable/operation failures, but it extends
the client's neutral `ColanderTransportError`. Core failures are re-thrown as the core's own
`ColanderError`, so both `kind` (`invalid_request`, `validation`, `panic`) and `code` — the
`SCREAMING_SNAKE` token such as `INVALID_SEMVER`, `RULE_UNKNOWN_CODE` or `REQUEST_TOO_LARGE` — reach
the consumer unchanged. `validateSchema` is the one operation that answers instead of throwing, and
its `{ valid: false }` branch carries the same `code`.

## Runtime boundary

The dependency direction is:

```text
@ailura/colander-browser ──> @ailura/colander
@ailura/colander-browser ──> @ailura/colander-client (neutral errors)
```

There is no React, NestJS, HTTP, or duplicate WASM implementation in this package. In Node, the core
reads its packaged WASM file from disk. In a browser or Worker, the core fetches the same-origin
`wasm/colander.wasm` asset. The core package exposes explicit Node/browser loader seams; this
package preserves that behavior and does not claim that browser operation is network-free.

## Development

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm --filter @ailura/colander-browser run check
pnpm --filter @ailura/colander-browser run test:unit
pnpm run audit
```

The package supports Node `>=20.19.0` at runtime. The workspace development toolchain uses pnpm
`12.3.4`, Vite+ `1.0.0-rc.0` (Vite 8 / Vitest 5), and TypeScript 5.9. `pnpm run test:bundler` runs
the available React/Vite production boundary; a full interactive browser runner is not required by
this package.

## License limitation

The manifest retains its existing MIT declaration. This checkout has no approved license file to
copy into the archive; the release owner must add the repository-approved license text before
publication.
