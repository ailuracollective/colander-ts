# Stop producing tarballs: the audit is the whole value of packing

## Objective

The repository still produced a `.tgz` per package plus a local alias, from a script that read the
archive back to check it. This change removes the artifact and keeps the check, because the artifact
was never an input to anything.

## Problem

**1. The archive was never needed to publish.** `npm publish` builds the tarball itself from the
package directory. The `.tgz` files this repository produced were an intermediate that nobody
consumed: after the examples moved to `link:`, nothing referenced them.

**2. The archive listing was the last thing that needed a tarball.** `pack-package.mjs` produced an
archive and then read it back with the npm `tar` package to assert that every export target and the
WebAssembly asset were inside it. That check is npm's own inclusion logic, not a reading of the
manifest, so it is worth keeping — and `npm pack --dry-run --json` reports exactly that list without
writing a file:

```text
filename: ailura-colander-0.1.0.tgz | entryCount: 25 | bytes: 639057
  README.md, dist/errors.d.ts, …, wasm/colander.wasm
```

**3. The audit could no longer live in `prepack`.** `npm pack` runs the `prepack` lifecycle, so an
audit inside `prepack` calls `npm pack`, which calls `prepack`. The first version of this change
recursed until the executor died. The audit now runs `npm pack --dry-run --ignore-scripts`, which
keeps it a pure read: it inspects what is on disk without preparing it.

## Authorized scope

- `scripts/pack-package.mjs` → `scripts/audit-package.mjs`, audit only.
- `packages/*/package.json`: `pack` removed, `audit` added, `prepack` back to clean + build only.
- Root `package.json`: `pack` is now the pre-publication gate; the npm `tar` devDependency removed.
- `packages/colander/test/packaging.test.ts`: the lifecycle contract it asserted.
- Four READMEs.

## Non-goals

- Publishing is unchanged. `npm publish` and `pnpm publish` work exactly as before, and were
  re-verified with `--dry-run` on all three packages.
- The `prepack` lifecycle stays, because a real publish still needs `dist` built from a clean state.

## Design

**The audit is two halves.** The manifest half proves each `main`, `types` and `exports` target
exists on disk, that `files` covers it, and that the core ships its WebAssembly asset; it names the
offending entry. The registry half asks npm what it would include and proves every required entry is
in that list. Neither writes anything.

**`pack` is now a gate, not a producer.** `pnpm run pack` builds every package and audits all three
manifests. It is what a release owner runs before `npm publish`, and what the repository README calls
the pre-publication step. `release:pack` is the same plus the network-backed WASM rebuild.

**`prepack` is `clean && build` again.** The audit deliberately sits outside it, because the audit
invokes `npm pack`. The test in `packaging.test.ts` now asserts that separation, so the recursion
cannot come back silently: every package must have `audit`, must not have `pack`, and must have
`prepack` set to clean-then-build only.

**`npm publish --dry-run` is the smoke test.** It reports the full tarball details — filename, size,
unpacked size, shasum, integrity, total files — and writes no file, which is how publishing was
re-verified here.

## Acceptance

- `pnpm -r run audit` passes for all three packages and runs inside `pnpm run check`.
- `npm publish --dry-run` succeeds for all three packages, reporting 25, 30 and 14 files.
- `pnpm run verify` completes: Nest unit and e2e, React unit and SSR.
- No `.tgz` exists in the repository, and none is produced by any command.
- The npm `tar` devDependency is gone from the root manifest and the lockfile.
- `pnpm run lint`, `typecheck`, `fmt:check` and `test` pass across the workspace.

## Tasks

- [x] T1 Rewrite `pack-package.mjs` as an archive-free audit.
- [x] T2 Remove the npm `tar` devDependency and regenerate the lockfile.
- [x] T3 Rewire `pack` and `release:pack` as the pre-publication gate, per package and at the root.
- [x] T4 Delete the six archives, update four READMEs, run everything.

## Commits

None. No commit was requested.

## Result

`scripts/` is three files and 368 lines with **zero third-party dependencies**. No archive is produced,
consumed, or kept. Publishing is intact, and the check that used to require a tarball now runs from
npm's own dry-run report on every change.
