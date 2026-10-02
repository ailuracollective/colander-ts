# Generated tree always lives in `<root>/.colander/`

## Why

`colander.map.json` was landing wherever the consumer's `outDir` pointed, which in
practice was `src/generated/colander`: a generated, gitignored-by-convention
artifact sitting inside the hand-written source tree. That is where the drift between
"what a build writes" and "what someone committed" starts, and it puts a file nobody
edits next to the files everyone does.

The tree is a build artifact. It should have one fixed home that is obviously not source,
and it should be ignored by git.

## Decisions (user-owned, closed 2026-02-11)

1. **Fixed location.** The whole generated tree is written to `<root>/.colander/`,
   including `colander.map.json`. The plugin no longer takes `outDir`, and a call that
   declares one is refused rather than silently ignored.
2. **Drift guard unchanged.** `findStaleGeneratedFiles` / `assertGeneratedTreeIsCurrent`
   keep comparing bytes on disk. A clean checkout reports stale until `colander generate`
   runs. This is accepted, not fixed.
3. **Gitignore is the consumer's job.** No code writes to a consumer's `.gitignore`.
   The package documents the line; the example applies it.

## Not in scope

- The CLI keeps `--out-dir` as an explicit override; it only changes its documented
  default to `.colander`, so the plugin and the CLI agree on where the tree lives.
- The core library functions (`generateComponents`, `findStaleGeneratedFiles`) keep
  taking an explicit `outDir`: they are a library surface, not a convention.

## Tasks

### T1 — Plugin writes to `<root>/.colander/`
Remove `outDir` from `ColanderPluginOptions`; derive the directory from the root.
Refuse a call that declares `outDir`, naming the fixed directory.
Allowed surfaces: `packages/colander-compiler/src/plugin.ts`,
`packages/colander-compiler/src/generate.ts` (docs only).
Status: done

### T2 — Tests follow the new location
`plugin.test.ts` and `discovery-plugin.test.ts` assert the fixed directory and the new
refusal. `generate.test.ts` and `check.test.ts` are untouched: the library still takes
`outDir`.
Allowed surfaces: `packages/colander-compiler/test/plugin.test.ts`,
`packages/colander-compiler/test/discovery-plugin.test.ts`.
Status: done

### T3 — Docs state the fixed directory and the ignore
`packages/colander-compiler/README.md`, the root `README.md` if it names a generated
path, and the "the generated tree is meant to be committed" claim in `generate.ts`.
Allowed surfaces: `packages/colander-compiler/README.md`, `README.md`,
`packages/colander-compiler/bin/colander.mjs`, `packages/colander-compiler/src/generate.ts`.
Status: done

### T4 — Example moves to `.colander/`
`colander-options.ts` drops `outDir`; the CLI scripts in `package.json` drop
`--out-dir`; the example's `.gitignore` gains `.colander/`; the stale
`src/generated/colander/` tree is removed. `generated-tree.test.ts` reads `.colander/`.
Allowed surfaces: `examples/react-app/src/lib/colander-options.ts`,
`examples/react-app/src/lib/generated-tree.test.ts`, `examples/react-app/package.json`,
`examples/react-app/.gitignore`, `examples/react-app/src/generated/`,
`examples/react-app/vite.config.ts`, root `.gitignore`.
Status: done

## Known consequence

`examples/react-app/src/lib/generated-tree.test.ts` asserts the tree on disk is current.
With the tree gitignored, a fresh clone has no `.colander/` and that test fails until
`pnpm generate` has run. Decision 2 accepted this. The example README says so.

## Verification

- `packages/colander-compiler`: `pnpm run test` → 120 passed, 1 failed
  (`test/plan.test.ts > names every key it does not recognise`), and `pnpm run typecheck` reports
  errors in `test/entrypoints.test.ts` and `test/plan.test.ts`. Both are pre-existing and untouched
  by this change: they are about key ordering in a message and `exactOptionalPropertyTypes` in
  test fixtures.
- `examples/react-app`: `pnpm run generate` writes `.colander/colander.map.json`;
  `pnpm run check:generated` reports the tree current; `vitest run src/lib/generated-tree.test.ts`
  → 3 passed. `pnpm run lint` and `pnpm run fmt:check` fail with "No files found to lint", which
  reproduces with the pre-existing ignore patterns too.

## Routing note

Delegation to `gentle-ai-worker` was attempted for every task. Two of the three launches stalled
with no edits; T1, T2, T3 and the `plugin.ts` type fix landed through a subagent, and the
`check.test.ts` repair, T4 and the example README were completed inline after the runtime kept
timing out.

## Follow-up: the plugin stopped narrating (same feature)

The generated tree is written on every build, so the plugin was printing six or seven
`[colander-compiler]` lines on a run that found nothing wrong. Decisions:

5. The plugin prints no progress and no summary. What it still prints, unconditionally and on
   `console.warn`, is a diagnostic about the consumer's project: a file that names no type, a type
   the mapping named but the core will not materialize, and the development `tsc` finding. The
   `log` option is gone from `ColanderPluginOptions` rather than defaulted to false: an option that
   no longer controls what it says about is a lie in the type.
6. The CLI is silent on success. Everything on `console.error` and every non-zero exit stay.
   `colander generate` that worked prints nothing; `colander check` that is stale still names the
   files and how to refresh them.
7. `group`, `repeater` and `component-ref` are declined by every mapping, so warning about them
   would put the same three lines in every consumer's terminal forever. The plugin skips a
   `not-materializable` rejection the mapping never named a component for, and keeps the warning
   when the mapping did name one — then the consumer wrote something and the core ignored it.
   `plan.ts`, `summarize` and `colander.map.json` are untouched by this filter.

Verified: `pnpm exec vitest run` in the package → 121 passed, the one pre-existing `plan.test.ts`
failure. A new test asserts a clean run collects no output on either console. In the example,
`pnpm run generate` and `pnpm run check:generated` both print only the pnpm script line and exit 0.
`pnpm run lint` in this package reports 512 violations across the whole baseline, most of them in
test files this change did not touch; it was not a passing check before this work and still is not.

## Follow-up: the plugin logs through Vite's logger (same feature)

Vite 8.3.0 exposes `ResolvedConfig.logger`, and Vite itself routes plugin build output through it
(`vitejs/vite#13757`), so `console.warn` was the exception rather than the norm. The plugin now
captures the logger in `configResolved` and reports through a `warn(message, once)` helper:
`warnOnce` for a fact about the project's files, which would otherwise repeat on every hot update,
and `warn` for the development `tsc` finding, which reflects the current state of the tree. The
prefix is `[colander]`. A host that resolves a config without a logger — a test, an unfamiliar
bundler — falls back to `console.warn`. The benefit a consumer actually feels: `logLevel: 'silent'`
now silences this plugin, and a diagnostic is not reprinted on every regeneration.

8. The warning about a file in the controls directory naming no type is gone. A misspelled control
   that leaves its type with no file already fails the build by name, and the warning fired on every
   legitimate helper beside the controls (`shared.tsx`, `shell.tsx`, `index.ts`). No heuristic was
   added to tell a typo from a helper, per the decision. `DiscoveredComponents.ignored` stays as a
   library surface; the plugin no longer reads it.

Verified: package suite → 122 passed, the pre-existing `plan.test.ts` failure unchanged. Example
`generate`, `check:generated` and `generated-tree.test.ts` all green and silent.
