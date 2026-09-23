# Use the npm tar package for crate extraction

## Objective

Replace the build script's system `tar` inspection and extraction commands with the recent stable npm
`tar` package while preserving the published crate checksum, archive safety boundary, Cargo build,
WebAssembly validation, ABI contract, and temporary-directory cleanup.

## Problem

The current script shells out to the operating system `tar` twice for textual inspection and once for
extraction. That makes the build depend on a platform-specific executable even though the project
already has a cross-platform Node toolchain. The replacement must be at least as restrictive before
any archive entry is written.

## Scope

- Add a recent stable `tar` development dependency using the repository's pnpm lockfile.
- Refactor `scripts/build-wasm.mjs` to use `tar` APIs, with a non-writing validation pass followed
  by filtered extraction of the same SHA-verified bytes.
- Preserve the exact crate URL, version, SHA-256, target, required exports, Cargo arguments, and
  cleanup behavior.
- Reject unsafe paths, duplicate entries, links, special files, unsupported entry types, and
  Windows-invalid or case/normalization-aliased filenames.
- Update the README so it no longer documents a system `tar` prerequisite.
- Add focused tests only where they can protect the script's security contract without introducing a
  second build architecture.

## Constraints and acceptance criteria

- Do not use the OS `tar` executable or parse `tar --list` output.
- Do not set `preservePaths: true`.
- The archive must pass SHA-256 verification before inspection or extraction, and extraction must
  consume the verified in-memory bytes rather than reopening the archive.
- Extraction must be rooted at a newly-created temporary source directory and accept only regular files
  and directories under `colander-0.1.0/`.
- Reject absolute paths, `..` components, backslashes, NULs, duplicate normalized paths, symbolic and
  hard links, FIFOs, devices, zero-length metadata, and all other non-file/non-directory entries.
- The built module must pass `WebAssembly.validate` and `WebAssembly.compile`, have zero imports,
  contain all 11 required functions, and omit `colander_last_panic`.
- Cargo stderr/stdout must remain visible on failure, and `finally` must always remove the temporary
  root.
- Node 20+ and Linux/macOS/Windows compatibility must be preserved.
- No feature flag, new build abstraction, or security relaxation is allowed.

## Work units

- [x] **T1 — Refactor archive handling.** Replace external `tar` calls with npm `tar` inspection and
  extraction, retaining checksum-first ordering and all project-specific checks. Route: direct
  implementation; trigger: the script has a non-trivial security boundary and must be coordinated with
  dependency metadata.
- [x] **T2 — Update dependency and docs.** Add the lockfile dependency and correct the build
  prerequisites and description. Route: direct implementation with T1 because it touches the same
  reproducibility unit; trigger: multiple non-trivial files.
- [x] **T3 — Verify behavior and safety.** Run focused tests, lint/typecheck/format checks, inspect the
  diff, and run the WASM build when Cargo and the target are available. Route: direct verification;
  no review-risk judgment is delegated here.

## TDD and checks

- Effective TDD mode: not configured for this project; ordinary functional checks are required.
- Focused test command: `pnpm exec vp test`.
- Quality commands: `pnpm exec vp check`, `pnpm exec vp fmt --check`, and `pnpm typecheck`.
- Build command: `pnpm exec vpr build:wasm` (record the exact outcome, including missing Cargo/target).
- Security review must confirm that no OS `tar` invocation or textual archive listing remains and that
  extraction is filtered and rooted in the temporary directory.

## Progress and evidence

- Implementation complete: `scripts/build-wasm.mjs` verifies the bytes read from disk, performs a
  non-writing `Parser` pass with no archive path or `file` option, and feeds those same verified bytes
  to a no-file, filtered `extract` stream. The validator explicitly rejects an archive with no accepted
  file/directory entries.
  `maxMetaEntrySize: -1` plus shared `ignoredEntry`/`meta` handlers rejects zero-length metadata and
  unknown types in both passes; parser/unpacker errors remain fatal.
- Path validation now rejects Windows-invalid characters, control characters, trailing spaces/dots,
  reserved DOS device names, and duplicate keys after NFKD normalization and case folding. It checks
  effective, header, extended, and global-extended path strings. The exact `colander-0.1.0/` root
  prefix, absolute/traversal/backslash checks, Cargo command, ABI checks, and unconditional cleanup
  remain unchanged.
- `package.json` and `pnpm-lock.yaml` contain `tar@7.5.22`; README wording remains free of a system
  `tar` prerequisite.
- Focused test: `pnpm exec vp test` — PASS (2 test files, 17 tests).
- Quality checks: `pnpm exec vp check` — PASS; `pnpm exec vp fmt --check` — PASS; `pnpm typecheck` — PASS;
  `node --check scripts/build-wasm.mjs` — PASS; `pnpm install --frozen-lockfile` — PASS.
- Build: `pnpm exec vpr build:wasm` — PASS after one transient crates.io timeout. The exact SHA-256
  matched, Cargo completed with the preserved command, and `wasm/colander.wasm` was copied (1,494,683
  bytes). No temporary `colander-wasm-*` directory remained.
- Ephemeral security checks passed: verified-byte extraction, zero-length metadata rejection in both
  passes with no extraction output, six Windows-invalid path forms, global-extended path rejection,
  and case/NFKD duplicate aliases. No raw-byte NUL scanner was added because tar headers use NUL
  terminators and padding; explicit decoded/header/extended path NUL checks remain in place.
- No archive-safety tests were added: the validator remains private to the top-level build script, and
  a committed test would require exporting/refactoring it or duplicating the security logic. Existing
  tests cover the packaged binding, not archive extraction.
- The repository is unborn, so Git cannot provide a normal staged/unstaged diff; the changed package
  manifest, script, lockfile, README, and task document were inspected directly. No commit was created;
  work-unit commit evidence remains for the parent.
- Engram mirror pending: Engram tools are not exposed in this runtime.
