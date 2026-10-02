# Harden the developer experience of the component compiler

## Objective

Remove the ways a consumer can be wrong in `colander.config.ts` without finding out. Every change
here removes a failure that is currently silent: a mistyped type that quietly produces no control, a
control that quietly loses a property, a stale module that quietly lingers.

## Problem

The compiler is honest about what it declines, and that honesty is not reaching the consumer. A
mapping key that names no type is dropped without a word. A type the consumer did not map produces a
line in a build log most people never read. A generated module for a type that no longer exists stays
on disk and keeps compiling. The core's own semantic table is not watched, so upgrading the core does
not regenerate the tree. None of these are the compiler being wrong; they are the compiler being right
and quiet, which for a form builder means a field that renders nothing and an answer that can never be
entered.

## Scope

- Refuse a mapping key that names no type in the core's vocabulary, naming the key.
- Let a consumer require that every materializable type is mapped, and fail the build otherwise.
- Prune generated modules by default, since the directory belongs to the compiler.
- Watch the core's semantic table from the plugin, without the consumer listing it.
- Make a control that is written JSX checkable while developing, not only at build time.
- Shorten the `imports` shape, move the dispatch cast out of consumer code, ship the drift guard, and
  ship a `generate` entry point.
- Remove the dead export, unify the error surface, and record a fingerprint in generated files.

## Constraints

- The compiler still never names a framework, a component, or a library.
- The planner stays pure and side-effect free; nothing here makes it touch the filesystem.
- The core's vocabulary is the only authority on what a type name is.
- Generated files stay disposable and marked as generated.
- Ordinary functional verification; strict TDD is not configured.
- No commit, push, or pull request is authorized.

## Authorized scope

`packages/colander-compiler` (source, tests, README, manifest), `examples/react-app` (config,
generated tree, its drift test, scripts, README), and this feature document. The core packages and
the other examples are untouched.

## Work units

- [x] **P1 — Refuse an unknown mapping key.** A key that names no type in the core vocabulary is
  rejected by name, so a typo cannot pass unnoticed.
- [x] **P2 — Let a consumer require a complete mapping.** An explicit strictness the build enforces.
- [x] **P3 — Prune by default.** The generated directory is the compiler's; a removed type leaves
  nothing behind unless the consumer opts out.
- [x] **P4 — Watch the core's semantic table.** The plugin resolves the module it reads the table
  from and regenerates when it changes.
- [x] **P5 — Check a written control while developing.** A generated tree that type-checks before
  the app is served, so a property typo is not invisible until the build.
- [x] **P6 — Shorten the authoring surface.** A compact `imports` shape, a generated dispatcher, a
  shipped drift guard, and a `generate` entry point.
- [x] **P7 — Clean the edges.** Remove the dead export, unify the error surface, name the concepts
  once, and record a fingerprint.

## Acceptance criteria

- A mapping key that names no type fails with the key in the message.
- A consumer can make an unmapped materializable type a build failure.
- Removing a type from the mapping removes its generated module on the next run.
- Editing the core's semantic table regenerates the tree in development, with no configuration.
- A property typo inside a written control is reported before the app is served.
- The `imports` shape no longer repeats the module per entry, and the consumer's walker needs no cast.
- A consumer writes no bytes-comparison test: the library ships the guard.
- A consumer regenerates with one command, without a script that pokes bundler internals.
- The generated files carry a fingerprint of what produced them.
- Compiler, monorepo and React example checks stay green, and the results are recorded honestly.

## Progress

- Feature document created before the first source write.
- The findings came from exercising the library as a new consumer: a mistyped key, a partial
  mapping, a removed type, and a property typo inside a written control.
- P1 done: a key naming no core type is refused by name, saying a typo is the likely cause. Verified
  by running the real scenario: `choise` fails the build where it used to pass.
- P2 done: `onUnmapped: "refuse"` in the plugin call or the configuration file fails the build, and
  `assertCompleteMapping()` is the test form. Verified by deleting a type from the example's config
  and observing exit code 1 with the type named.
- P3 done: pruning is on by default, and only files carrying the compiler's marker are removed, so a
  hand-written file beside the tree survives.
- P4 done: the plugin resolves the semantics module it imports and watches it. The example no longer
  lists a path inside a dependency.
- P5 done: after each generation in development the plugin compiles the tree with the project's own
  TypeScript and prints what it finds. Verified end to end in the example: a `minLenght` typo inside
  a written control is reported in development, naming the generated file, the line and the
  property, where before it was invisible until a build. Two related findings came out of building
  it: a development check that runs against a solution `tsconfig.json` reports success without
  reading a line, so a project that lists no sources is refused with the fix in the message; and
  `tsc` is not on the path a bundler starts plugins with, so the project's own binary is found by
  path and `checkTsc` overrides it.
- P6 done: `imports` is a map from export name to module; the generated tree exports
  `renderColanderField` so a consumer's walker needs no cast at all; `assertGeneratedTreeIsCurrent()`
  and `assertCompleteMapping()` ship the drift and completeness guards; and `colander generate` /
  `colander check` are commands, so a project writes no script that reaches into bundler internals.
  The React example's drift test went from 81 lines of hand-written byte comparison to 28, and its
  walker from a cast plus a lookup to a single call.
- P7 done: the dead `describeOutDir` export is gone; every refusal is now one `ColanderCompilerError`
  carrying `kind` (`mapping` | `config` | `template`) plus `subject` and `path`, so a caller catches one
  class instead of three; `props.ts` is `readers.ts`, which says what it holds; and every generated
  file carries a `// contents:` mark, a digest of its own body. The mark is per file rather than per
  tree on purpose — a tree-wide mark made every edit rewrite all twelve modules, burying a one-type
  change in a commit that touched everything.
- Compiler: 188 tests, typecheck, lint and format clean, audit passing with 11 targets. React
  example: `tsc -b` clean, 55 tests, SSR passing, lint without errors, build green.

## Decisions

- An unknown key is a hard error and an unmapped type is not. A consumer may legitimately not want
  a `time` control; a key that names nothing is always a mistake.
- Pruning is on by default because the output directory is the compiler's. A consumer who keeps
  something by hand in it can turn it off.
