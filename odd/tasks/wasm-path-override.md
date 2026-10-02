# WASM path override

Goal: one default (packaged asset) plus one environment override for any filesystem path.

## Decisions (user-confirmed)

- `COLANDER_WASM_PATH` is read only under the Node runtime. Browser/Worker ignore it and use the packaged asset.
- Precedence: explicit `colander.load(source)` bytes > `COLANDER_WASM_PATH` > packaged `wasm/colander.wasm`.
- The value is a filesystem path, absolute or relative to `process.cwd()`. No `file:` URL, no http(s).

## Tasks

- [ ] T1 Loader: read `COLANDER_WASM_PATH` in the Node branch, resolve relative to cwd, keep browser branch untouched. `packages/colander/src/loader.ts`
- [ ] T2 Tests: override honoured, blank treated as unset, relative resolution, browser branch ignores env. `packages/colander/test/binding.test.ts`
- [ ] T3 Docs: document the variable and the precedence in `packages/colander/README.md` and root `README.md`.

## Commits

(work-unit commits are the user's call; record here when made)

## Follow-up: lint green inside the package

Task file: `odd/tasks/colander-lint-clean.md`. Baseline is 46 errors, sibling packages report 0.
Scope is `packages/colander/**` only. The root `vite.config.ts:272` allow list stays untouched, so
`node:path` is resolved with local eslint directives instead of widening the workspace rule.