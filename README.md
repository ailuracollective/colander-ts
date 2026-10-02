# Colander monorepo

This repository is a private pnpm workspace for four publishable Colander packages and two isolated
consumer examples.

| Package                     | Path                                                       | Owner                                                                       |
| --------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@ailura/colander`          | [`packages/colander`](packages/colander)                   | TypeScript/WASM binding, `colander.load()`, and `wasm/colander.wasm`        |
| `@ailura/colander-client`   | [`packages/colander-client`](packages/colander-client)     | Source-neutral transport, neutral errors, and headless form-model contracts |
| `@ailura/colander-browser`  | [`packages/colander-browser`](packages/colander-browser)   | Canonical browser lifecycle adapter around the core                         |
| `@ailura/colander-compiler` | [`packages/colander-compiler`](packages/colander-compiler) | Build-time compiler from the core's semantic types to a consumer-owned tree |

The examples remain separate pnpm workspaces. `poc/` is the single packed-package consumer smoke
project; it is not a second application scaffold.

## Quick path

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run fmt:check
pnpm run test
pnpm run pack
```

`pnpm run audit` is the check that runs on every change, and it is part of `pnpm run check`. It
proves two things per package. The manifest half: every `main`, `types` and `exports` target exists
on disk, `files` covers it, and the core ships its WebAssembly asset. The registry half: npm itself
agrees, asked with `npm pack --dry-run --json`, and every required entry is in the list it would
publish. It writes no file and touches no network.

**This repository produces no `.tgz`, and does not need to.** `npm publish` builds the archive
itself from the package directory, so a local archive was never an input to publishing; it was an
intermediate that nobody consumed and that made every `dist` rebuild invalidate the tarball digest
in the consumers' lockfiles.

`pnpm run pack` is therefore the pre-publication gate rather than a producer: it builds every
package and audits all four manifests. Each package's `prepack` lifecycle removes only its generated
`dist` before rebuilding it, so stale output cannot enter a release, and `npm publish` runs that
same lifecycle. To see exactly what a publish would send without sending it:

```bash
npm publish --dry-run    # from a package directory
```

Ordinary builds do not rebuild WASM: they use the checked-in `packages/colander/wasm/colander.wasm`
package input and require no network access.

To verify the isolated consumers:

```bash
pnpm run bootstrap
# equivalent alias:
pnpm run verify
```

The bootstrap command audits the manifests, builds the workspace, and then installs, builds and
tests each consumer offline: Nest including `test:e2e`, React, and the React SSR check. The
consumers are linked to the packages by directory (`link:../../packages/<name>`), deliberately
outside this workspace so each keeps its own toolchain and lockfile. A link still resolves through
the package's own `exports`, so a consumer imports `dist` and not the source: the published shape is
what gets exercised, and rebuilding a package does not change a consumer lockfile.

## Workspace commands

The root commands use an explicit package matrix. A missing required package script is an error;
capabilities are never silently skipped.

| Command                        | Coverage                                                                   |
| ------------------------------ | -------------------------------------------------------------------------- |
| `pnpm run build`               | `build` for core, client, browser, and compiler                            |
| `pnpm run check` / `check:fix` | package format, lint, and type gates                                       |
| `pnpm run fmt` / `fmt:check`   | package formatting                                                         |
| `pnpm run lint`                | package lint                                                               |
| `pnpm run test`                | package unit suites                                                        |
| `pnpm run test:unit`           | explicit unit suites, including the core binding boundary                  |
| `pnpm run test:contract`       | required frozen-vector contract suite                                      |
| `pnpm run typecheck`           | package test/type configurations                                           |
| `pnpm run pack`                | build, declaration generation, and all four publish manifests              |
| `pnpm run test:bundler`        | React production build and emitted WASM asset smoke                        |
| `pnpm run clean`               | generated `dist` directories only; it never removes the core WASM artifact |

## Frozen contract corpus

`pnpm run test:contract` is reproducible offline. It uses the checked-in corpus and adjacent lock at
`packages/colander/test/fixtures/contract-vectors/colander-0.1.0/` by default. The sibling source is
identified in that lock as `colander sibling repository`, commit
`80c8f358f33983efe6aad46f753db28321934938`, describe `v0.1.0-37-g80c8f35`; no repository URL is
invented.

The suite's first case is the corpus preflight: it verifies the lock, all five file SHA-256 values,
JSON arrays, raw record counts, replay inventory, and every explicit ABI-boundary exclusion. A
missing, malformed, non-array, digest-mismatched, or stale exclusion fails with the affected path
and reason, so the contract run stops there rather than replaying vectors it cannot trust. There is
no automatic fallback to a mutable sibling checkout. `COLANDER_VECTORS` is only an explicit
override; its `corpus.lock.json` must be in the override directory, and no parent or sibling lock is
searched.

To refresh the corpus, make an explicit core/corpus version decision, copy the five files without
record transformations, update `corpus.lock.json` and its replay counts/exclusions together, then
run `pnpm run test:contract` before using the new corpus.

## Offline and release packaging

The ordinary local path is offline and uses the checked-in `packages/colander/wasm/colander.wasm`
input owned by the core package. Every publishable package's `prepack` lifecycle removes only its
own `dist` before TypeScript/build output is generated, so stale output cannot silently become a
release artifact. No archive is written at any point: a `.tgz` is the npm registry's format, and
`npm publish` produces it from the package directory, so the repository has nothing to build,
consume, or keep in sync.

WASM rebuild is a separate release operation because it may download and compile Rust sources:

```bash
pnpm run release:pack
```

That command runs the core `build:wasm:release` lifecycle explicitly, which additionally requires an
engine digest. Use `pnpm run pack` for ordinary local packaging and consumer verification.

## Engine origin

`pnpm run build:wasm` chooses where the engine comes from through the environment, and it will not
guess: `COLANDER_WASM_SOURCE` is required, because no remote origin can currently supply a
WebAssembly engine.

| Variable               | Required | Meaning                                                                              |
| ---------------------- | -------- | ------------------------------------------------------------------------------------ |
| `COLANDER_WASM_SOURCE` | yes      | Origin spec. Unset or blank is an error that names the accepted forms.               |
| `COLANDER_WASM_SHA256` | no       | Expected SHA-256 (64 hex characters) of the produced engine artifact.                |
| `COLANDER_WASM_OUTPUT` | no       | Destination file. Defaults to the checked-in `packages/colander/wasm/colander.wasm`. |

The spec grammar is `<origin>:<reference>`:

```bash
# Git repository: export one commit read-only, then compile the crate at its root
COLANDER_WASM_SOURCE=git:../colander@d54a86e pnpm run build:wasm

# GitHub: download the prebuilt release asset; no Rust toolchain and no source build
COLANDER_WASM_SOURCE=github:ailuracollective/colander@v1.0.0 pnpm run build:wasm
COLANDER_WASM_SOURCE=github:ailuracollective/colander@v1.0.0!colander-rc.wasm pnpm run build:wasm

# Local path: fully offline, either a built engine or a crate directory
COLANDER_WASM_SOURCE=path:../colander-rs/target/wasm32-unknown-unknown/release/colander.wasm pnpm run build:wasm
COLANDER_WASM_SOURCE=path:../colander-rs pnpm run build:wasm
```

Origin rules:

- `git:<repository>@<ref>` accepts a local path or a URL and a commit, tag, or branch. A local
  repository is exported with `git archive` into a temporary directory, so its working tree, index,
  and refs are never touched; a remote is fetched shallowly into the same temporary space. The
  revision must be the crate root, or a tree whose entire content is one crate directory.
- `github:<owner>/<repo>@<release-tag>[!<asset>]` downloads
  `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>`. The tag must be a release tag
  such as `v1.2.3`; a branch or commit is rejected. The default asset is `colander.wasm`.
- `path:<target>` never touches the network. A target ending in `.wasm` is validated and copied; any
  other target must be a directory containing `Cargo.toml` and is compiled with cargo. Relative
  paths resolve against the current working directory.

Neither remote origin can supply the engine today. The `v1.0.0` release of
`ailuracollective/colander` publishes only `libcolander.so`, so a `github:` origin asking for
`colander.wasm` answers `404`; and `colander` was never published on crates.io, which is why there
is no `crate:` origin at all and no default. Build the engine from a local checkout with the `path`
or `git` origin until that repository attaches a `colander.wasm` release asset.

Every origin passes the same module verification: the bytes must be a valid WebAssembly module, must
import nothing, must export all eleven engine entry points, and must not export the removed
`colander_last_panic`. A failure aborts before the destination file is written.

When `COLANDER_WASM_SHA256` is set, the produced artifact must match it. The release script
(`build:wasm:release`, used by `pnpm run release:pack`) requires that digest for **every** origin:
the crate origin that carried an in-code digest is gone, so a release artifact has to be pinned to
bytes someone verified. An unset digest means an unset variable; an absent optional value is an
empty string, never an implicit "trust me".

## Support matrix

Runtime and development support are intentionally distinct:

| Surface                    | Runtime Node | Development toolchain                                                 |
| -------------------------- | ------------ | --------------------------------------------------------------------- |
| Three publishable packages | `>=20.19.0`  | pnpm `12.3.4`; Vite+ `1.0.0-rc.0` (Vite 8 / Vitest 5); TypeScript 5.9 |
| Nest example               | `>=20.19.0`  | pnpm `12.3.4`; Nest 12; its locked Vitest 4 toolchain                 |
| React example              | `>=20.19.0`  | pnpm `12.3.4`; Vite 8; Vitest 5; TypeScript 6                         |
| Packed consumer            | `>=20.19.0`  | pnpm `12.3.4`; TypeScript 5.9                                         |

The root development engine is Node `^22.18.0 || ^24.11.0 || >=26.0.0`; the lower runtime range
describes the published package contract, not the older Node versions accepted by every development
tool.

## Dependency direction

```text
colander-browser ──workspace:*──> colander
colander-browser ──workspace:*──> colander-client (neutral error contracts)
colander-client                   (no core, React, HTTP, or browser dependency)
```

`colander.load()` and the WASM file belong only to `@ailura/colander`. The client package never
imports that core. React uses the browser package for direct WASM lifecycle behavior and keeps only
its HTTP source-specific adapter in the example.

## Artifact ownership and troubleshooting

| Symptom                                                    | Action                                                                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `dist/index.js` or `dist/index.d.ts` missing while packing | Run `pnpm run pack`; its `prepack` lifecycle cleans and rebuilds `dist`, then validates the archive.                                          |
| `wasm/colander.wasm` missing                               | Restore/build the core artifact, then run `pnpm run pack`. Use `pnpm run release:pack` only when a release rebuild is intended.               |
| `COLANDER_WASM_SOURCE` unset or rejected                   | The message names the accepted forms. There is no default: set a `path:`, `git:` or `github:` origin.                                         |
| `colander.load()` names `COLANDER_WASM_PATH` and a path    | The Node-only engine-path override could not be read, and it never falls back to the packaged asset. Fix the path or unset the variable.      |
| Engine SHA-256 mismatch                                    | The expected and actual digests are both printed. Rebuild from the intended origin or update `COLANDER_WASM_SHA256` to the reviewed artifact. |
| Frozen example install rejects a tarball or digest         | Run `pnpm run pack`, then regenerate that example's lockfile with its offline install command; do not hand-edit the lockfile.                 |
| A contract test fails on the frozen corpus                 | Use the checked-in corpus and `corpus.lock.json`; repair the reported file/digest/inventory issue before rerunning `pnpm run test:contract`.  |
| Browser build warns about `node:fs/promises`               | This is the expected explicit Node branch externalized by Vite; the browser asset emission is covered by `pnpm run test:bundler`.             |

When an archive's content changes, regenerate each isolated lockfile with the same offline fix flow;
`--fix-lockfile` is required for pnpm to recalculate a local tarball digest:

```bash
pnpm --dir examples/nest-app install --offline --lockfile-only --force --fix-lockfile
pnpm --dir examples/react-app install --offline --lockfile-only --force --fix-lockfile
pnpm --dir poc install --offline --lockfile-only --force --fix-lockfile
```

Generated `dist`, `node_modules`, versioned archives, and stable local archive aliases are ignored
artifacts. `packages/colander/wasm/colander.wasm` is different: it is a checked-in package input
required for offline packing. A deliberate `pnpm run release:pack` rebuild may replace that input,
after which the release owner must verify the resulting artifact and archive.

## Documentation and release notes

See [`RELEASE.md`](RELEASE.md) for the short publication checklist. Historical ODD task records
remain historical; active setup instructions live in this README and the package/example READMEs.

The package manifests retain their existing MIT metadata, but this checkout does not contain an
approved license file. The release owner must add the repository-approved license text before
publishing; no license text is invented here.
