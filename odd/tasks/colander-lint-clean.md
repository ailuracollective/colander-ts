# colander lint clean

Goal: `pnpm --filter @ailura/colander run lint` reports 0 errors. Package boundary only.

## Baseline

46 errors. Sibling packages (`colander-client`, `colander-browser`, `colander-compiler`) each report
0, so zero is the workspace standard and `@ailura/colander` is the only red package.

| File | Errors | Origin |
|---|---|---|
| `src/loader.ts` | 14 | 2 pre-existing, 12 from the `COLANDER_WASM_PATH` change |
| `test/binding.test.ts` | 23 | from the `COLANDER_WASM_PATH` change, incl. `max-lines` |
| `src/wasm.ts` | 6 | pre-existing |
| `test/{build-wasm,git-source,packaging}.test.ts` | 1 each | pre-existing |

## Boundary decision

`import/no-nodejs-modules` (root `vite.config.ts:272`) allow-lists only `node:fs/promises` for the
`neutral` runtime and catches dynamic `import()`. Fixing it properly means editing the root config,
which is out of scope. `node:path` therefore stays, justified with a local eslint directive rather
than by widening the workspace rule.

## Tasks

- [ ] L1 `src/loader.ts` — 14 errors: `no-undef` on `URL`/`fetch`, `no-ternary`, `no-undefined`,
      `no-optional-chaining`, `capitalized-comments`, `unbound-method`, `catch-error-name`, plus
      local directives for `no-nodejs-modules` and `import-style` on `node:path`.
- [ ] L2 `src/wasm.ts` — 6 `no-undef` on `WebAssembly`, `TextDecoder`, `TextEncoder`.
- [ ] L3 Split `test/binding.test.ts` into `test/binding.test.ts` + `test/loader-path.test.ts` to
      clear `max-lines`, and fix the 22 style errors across both.
- [ ] L4 Remove the three unused `eslint-disable sort-vars, one-var` directives.
- [ ] L5 Verify: lint 0, typecheck pass, test:unit no worse than 66 passed / 2 failed.

## Out of scope

- Root `vite.config.ts`. Not touched.
- The two `test/packaging.test.ts` failures: `scripts/clean-package.mjs` does not exist. That is a
  design decision (create the helper vs relax the test), tracked in issue #1 item 3.
- `packages/colander/dist/` is generated output.

## Commits

(work-unit commits are the user's call; record here when made)