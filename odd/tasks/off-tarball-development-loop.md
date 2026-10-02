# Get the packages off tarballs in the development loop

## Objective

The three example applications consumed the packages as `.tgz` archives. A tarball is the npm
registry's format, so one is produced when publishing — but nothing in the build, test, or
verification loop needs one. This change takes the archive out of the daily loop and keeps every
check it was carrying.

## Problem

**1. Rebuilding a package churned two lockfiles.** Each consumer depended on
`file:../../ailura-colander.tgz`, and the lockfile pinned the tarball by content:

```yaml
overrides:
  '@ailura/colander': file:../../ailura-colander.tgz
```

Every `dist` rebuild changed the archive bytes, so the `integrity: sha512-…` entry went stale and
`pnpm install --frozen-lockfile` failed until the package was repacked and both consumers reinstalled.
The `overrides` block in each example's `pnpm-workspace.yaml` existed only to force that archive
specifier onto transitive resolutions.

**2. 520 lines of script carried the loop.** `bootstrap-consumers.mjs` (351) packed every package,
asserted the two archives per package matched byte for byte, asserted each consumer's manifest
referenced the archive, re-derived a SHA-512 of the tarball to compare against each consumer
lockfile, then inspected the installed copy under `node_modules`. `pack-package.mjs` (169) packed
and then listed the produced archive.

**3. `pnpm run verify` was broken.** The script declared a third consumer, `poc/`, and that
directory does not exist in the repository. The chain ended with a `pnpm run typecheck` and
`pnpm run smoke` inside a directory that was never there.

## What a tarball was actually buying

The example's import resolved like this:

```text
examples/react-app/node_modules/@ailura/colander-client
  -> ../.pnpm/@ailura+colander-client@file+..+..+ailura-colander-client.tgz/...
  -> dist/
```

`dist`, not the source: the `exports` of all three packages points at `./dist/index.js`, so a
directory link resolves the built artifact exactly the same way. The archive added two things on top
of that, and only two: the package directory passes through the `files` allowlist, and the install is
a real unpack.

## Authorized scope

- `examples/react-app/package.json`, `examples/nest-app/package.json`: `file:…tgz` → `link:…`.
- `examples/*/pnpm-workspace.yaml`: drop the archive `overrides`.
- `examples/*/pnpm-lock.yaml`: regenerated.
- `scripts/pack-package.mjs`: `--audit-only` mode; packing and the archive listing stay behind it.
- `scripts/bootstrap-consumers.mjs`: rewritten without archives.
- Root and package `package.json`: an `audit` script per package, run from `check` and `verify`.
- `README.md` (root and package).

## Non-goals

- Publishing is unchanged. `pnpm run pack` still produces the versioned archive and the local alias,
  and still verifies the archive contents with the npm `tar` package, because that check exists to
  confirm npm's own inclusion rules and belongs where the archive is produced.
- The examples stay outside the workspace with their own toolchains and lockfiles. Making them
  members would change their dependency resolution wholesale, which is a larger decision than this.

## Design

**`link:`, not `workspace:*`.** The examples are deliberately not workspace members, and
`workspace:*` cannot resolve outside a workspace — verified:

```text
"@ailura/colander-browser@workspace:*" is in the dependencies but no package named
"@ailura/colander-browser" is present in the workspace
```

`link:` is the primitive that says what is actually wanted: a symlink to a directory, with no copy
and no archive. Each example already had a one-package `pnpm-workspace.yaml`, which stays.

**The lockfile stops moving.** A `link:` entry is a path, not a digest:

```yaml
'@ailura/colander-client':
  specifier: link:../../packages/colander-client
  version: link:../../packages/colander-client
```

Rebuilding `dist` and reinstalling the consumer with `--frozen-lockfile` is now a no-op, verified by
comparing the lockfile digest across a rebuild.

**The manifest check moved, the archive check stayed.** `pack-package.mjs` already audited every
export target against `files` *before* packing; that part now runs under `--audit-only` and is wired
into `check` and `verify`, so the coverage the tarball loop provided for the manifest still runs on
every change. The archive listing is not redundant: npm's inclusion rules have subtleties the
manifest does not express, and that check now runs only when an archive is produced.

**`bootstrap-consumers.mjs` keeps what is real.** It still installs each consumer offline and
frozen, still proves the linked package resolves its built output, still runs the manifest audit, and
still builds and tests Nest (including `test:e2e`) and React plus the SSR check. It drops the
archive artifact assertions, the archive specifier assertions, the lockfile SHA-512 comparison, and
the consumer that does not exist.

## Acceptance

- A `dist` rebuild does not change any consumer lockfile, and `pnpm install --frozen-lockfile`
  succeeds in both examples afterwards.
- `pnpm run audit` passes for all three packages and runs as part of `pnpm run check`.
- `pnpm run verify` completes: Nest unit and e2e, React unit and SSR.
- `pnpm run pack` still produces a versioned archive plus the local alias, and still verifies the
  archive contents.
- `pnpm run lint`, `typecheck`, `fmt:check`, `build` and `test` pass across the workspace.

## Tasks

- [x] T1 Move both examples to `link:` and drop the archive overrides.
- [x] T2 Split `pack-package.mjs` into an audit that needs no archive and a publish step.
- [x] T3 Rewrite `bootstrap-consumers.mjs` without archives or the missing `poc` consumer.
- [x] T4 Wire the audit into `check` and `verify`, update both READMEs, run everything.

## Commits

None. The examples are untracked and the monorepo refactor is uncommitted; no commit was requested.

## Result

`bootstrap-consumers.mjs` 351 → 194 lines, `pack-package.mjs` 169 → 216 with the audit now
separated and runnable on its own, no tarball consumed anywhere in the loop, and `pnpm run verify`
works again after having been broken by a consumer directory that does not exist.
