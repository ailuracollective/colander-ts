/**
 * The workspace Vite+ configuration.
 *
 * This file is the whole toolchain contract for the repository: the formatting style, the lint
 * rules, and the `pack` and `test` settings for the one package that needs package-relative ones.
 * It used to live in a shared base that every project imported, but only the two examples consume
 * anything outside this workspace, and they are isolated consumers with their own lockfiles. So
 * each example owns a small self-contained config, and the workspace owns this one.
 *
 * The isolated examples are deliberately not covered here. They are outside the pnpm workspace, so
 * no root config can reach them, and they are excluded from these rules to keep that boundary
 * honest: one config governs one tree.
 *
 * Vite+ applies this configuration to every package when `vp lint` or `vp fmt` runs from a package
 * directory, so packages declare no `lint` or `fmt` of their own. Package-specific rules live in
 * `lint.overrides` below, with globs relative to this file.
 */

import { defineConfig } from "vite-plus";
import type { UserConfig } from "vite-plus";

/**
 * Paths that are never this repository's source: build output, vendored trees, agent state, and the
 * frozen contract corpus, whose bytes are asserted against a digest and must not be reformatted.
 */
const repositoryIgnorePatterns = [
    ".atl/**",
    ".codegraph/**",
    ".idea/**",
    ".pi/**",
    "artifacts/**",
    "dist/**",
    "node_modules/**",
    "odd/**",
    "poc/**",
    "**/*.wasm",
    "pnpm-lock.yaml",
  ] as const,
  /** Build output and frozen fixtures inside one package. */
  packageIgnorePatterns = ["dist/**", "test/fixtures/contract-vectors/**"] as const,
  lintPlugins = [
    "eslint",
    "react",
    "unicorn",
    "typescript",
    "oxc",
    "import",
    "jsdoc",
    "jest",
    "vitest",
    "jsx-a11y",
    "nextjs",
    "react-perf",
    "promise",
    "node",
    "vue",
  ] as const;

/**
 * Joins a package scope to a glob, tolerating the empty scope of a package-local config.
 *
 * @param scope the package directory, or "" for the config's own directory
 * @param glob the glob, relative to that package
 * @returns the glob, relative to the config
 */
function scoped(scope: string, glob: string): string {
  return scope === "" ? glob : `${scope}/${glob}`;
}

/**
 * One directory of sources, and the runtime its code runs in. The runtime is what decides whether
 * importing a Node builtin is that package's job or a defect in it.
 */
interface PackageScope {
  readonly path: string;
  readonly runtime: Runtime;
}

type Runtime = "browser" | "neutral" | "node";

const workspacePackages: readonly PackageScope[] = [
    { path: "", runtime: "neutral" },
    { path: "packages/colander", runtime: "neutral" },
    { path: "packages/colander-browser", runtime: "browser" },
    { path: "packages/colander-client", runtime: "neutral" },
    { path: "packages/colander-compiler", runtime: "node" },
  ],
  packages = workspacePackages.map((scope) => scope.path),
  scopes = workspacePackages,
  within = (glob: string): string[] => scopes.map((scope) => scoped(scope.path, glob)),
  // Sources whose declared runtime decides which Node builtins they may import.
  sourcesOfRuntime = (runtime: Runtime): string[] =>
    scopes
      .filter((scope) => scope.runtime === runtime)
      .map((scope) => scoped(scope.path, "src/**/*.ts")),
  neutralRuntimeSources = sourcesOfRuntime("neutral"),
  nodeRuntimeSources = sourcesOfRuntime("node"),
  publicApiSources = within("src/**/*.ts"),
  scriptSources = within("scripts/**/*.mjs"),
  testSources = [
    ...within("src/**/*.test.ts"),
    ...within("src/**/*.spec.ts"),
    ...within("test/**/*.test.ts"),
    ...within("test/**/*.spec.ts"),
  ],
  // These files execute only in Node; keep the environment declaration narrow.
  nodeOnlySources = [...within("scripts/**/*.mjs"), ...testSources],
  // Boundary tests that drive the engine across the WASM edge, and the replay of the frozen
  // Vector corpus. Both are deliberately unusual, and both are single packages' fixtures.
  bindingSources = [...within("test/abi-parity.test.ts"), ...within("test/binding.test.ts")],
  vectorSources = [...within("test/vectors.test.ts"), ...within("test/contract-corpus.test.ts")],
  // Framework and toolchain configuration files follow their own conventions. This list includes
  // This file, which is a config file by the same argument as the files that defer to it.
  configSources = [
    ...new Set([
      ...within("vite.config.ts"),
      ...within("vitest.config.ts"),
      ...within("vitest.config.e2e.ts"),
      "vite.config.ts",
      "vitest.config.ts",
      "vitest.config.e2e.ts",
    ]),
  ],
  ignorePatterns = [
    ...new Set([
      ...repositoryIgnorePatterns,
      // The isolated examples own their own configs and their own checks.
      "examples/**",
      ...packages.flatMap((scope) =>
        packageIgnorePatterns.map((pattern) => scoped(scope, pattern)),
      ),
    ]),
  ],
  toolchain: UserConfig = {
    check: {
      fmt: true,
      lint: true,
    },
    fmt: {
      arrowParens: "always",
      bracketSameLine: false,
      bracketSpacing: true,
      embeddedLanguageFormatting: "auto",
      endOfLine: "lf",
      experimentalOperatorPosition: "end",
      htmlWhitespaceSensitivity: "css",
      ignorePatterns,
      insertFinalNewline: true,
      objectWrap: "preserve",
      printWidth: 100,
      proseWrap: "always",
      quoteProps: "as-needed",
      semi: true,
      singleAttributePerLine: false,
      singleQuote: false,
      sortImports: true,
      sortPackageJson: {
        sortScripts: true,
      },
      tabWidth: 2,
      trailingComma: "all",
      useTabs: false,
      vueIndentScriptAndStyle: false,
    },
    lint: {
      categories: {
        // Every category is an error.
        // There is no advisory tier in this repository.
        // A rule that is worth reporting is a rule worth failing on.
        // A project that cannot meet one says so with a scoped override that names the reason.
        // It does not say so by demoting the category.
        //
        // The cost of this choice is measured rather than guessed.
        // All seven together report 4,959 findings across the workspace.
        // Almost all of them are in test code that no lint had ever seen before this existed.
        // The per-scope totals live in `odd/tasks/unified-toolchain.md`.
        // The number can be watched instead of feared.
        correctness: "error",
        suspicious: "error",
        pedantic: "error",
        restriction: "error",
        perf: "error",
        nursery: "error",
        style: "error",
      },
      env: {
        browser: scopes.every((scope) => scope.runtime !== "node"),
      },
      ignorePatterns,
      options: {
        // A warning is not a softer error.
        // With every category at `error` there is nothing left to warn about.
        // Denying warnings also stops a rule that a future oxlint release demotes.
        // Otherwise that rule would quietly become non-blocking on its own.
        denyWarnings: true,
        maxWarnings: 0,
        reportUnusedDisableDirectives: "error",
        respectEslintDisableDirectives: true,
        typeAware: true,
        typeCheck: true,
      },
      overrides: [
        {
          // A Node package's source imports Node builtins for a living.
          // The restriction category that forbids them has nothing to say about it.
          env: {
            node: true,
          },
          files: nodeRuntimeSources,
          rules: {
            "eslint/no-console": "off",
            "import/no-nodejs-modules": "off",
            "node/no-process-env": "off",
            "node/no-sync": "off",
            "node/no-top-level-await": "off",
          },
        },
        {
          env: {
            node: true,
          },
          files: nodeOnlySources,
          rules: {
            "eslint/no-console": "off",
            "import/no-nodejs-modules": [
              "error",
              {
                allow: [
                  "node:child_process",
                  "node:crypto",
                  "node:fs",
                  "node:fs/promises",
                  "node:os",
                  "node:path",
                  "node:url",
                ],
              },
            ],
            "node/no-process-env": "off",
            "node/no-sync": "off",
            "node/no-top-level-await": "off",
          },
        },
        {
          files: publicApiSources,
          rules: {
            // The package contract intentionally exposes named public symbols.
            "eslint/init-declarations": "off",
            "eslint/max-lines-per-function": "off",
            "eslint/max-statements": "off",
            "eslint/no-duplicate-imports": "off",
            "eslint/no-useless-assignment": "off",
            "eslint/one-var": "off",
            "eslint/sort-imports": "off",
            "eslint/sort-vars": "off",
            "import/exports-last": "off",
            "import/group-exports": "off",
            "import/no-named-export": "off",
            "oxc/no-async-await": "off",
            "typescript/prefer-readonly-parameter-types": "off",
            // `typeof process` is the safe cross-runtime existence check.
            "unicorn/no-typeof-undefined": "off",
            "unicorn/prefer-ternary": "off",
          },
        },
        {
          files: neutralRuntimeSources,
          rules: {
            // A runtime-neutral library may not reach for a Node builtin. The one it needs is
            // `node:fs/promises`, for loading its own asset, and that is the whole allow list.
            "import/no-nodejs-modules": ["error", { allow: ["node:fs/promises"] }],
          },
        },
        {
          files: scriptSources,
          rules: {
            // Build and maintenance scripts are Node-only executables.
            // They carry protocol constants and capture subprocesses synchronously.
            // They enter at the top level.
            "eslint/func-style": "off",
            "eslint/init-declarations": "off",
            "eslint/max-statements": "off",
            "eslint/no-await-in-loop": "off",
            "eslint/no-magic-numbers": "off",
            "eslint/no-ternary": "off",
            "eslint/no-use-before-define": "off",
            "eslint/one-var": "off",
            "eslint/prefer-destructuring": "off",
            "eslint/preserve-caught-error": "off",
            "eslint/require-unicode-regexp": "off",
            "eslint/sort-imports": "off",
            "eslint/sort-vars": "off",
            "jsdoc/require-param-description": "off",
            "jsdoc/require-returns-description": "off",
            "nextjs/no-assign-module-variable": "off",
            "node/no-sync": "off",
            "node/no-top-level-await": "off",
            "oxc/no-async-await": "off",
            "oxc/no-optional-chaining": "off",
            "oxc/no-rest-spread-properties": "off",
            "typescript/no-unsafe-argument": "off",
            "typescript/no-unsafe-assignment": "off",
            "typescript/no-unsafe-call": "off",
            "typescript/no-unsafe-member-access": "off",
            "typescript/no-unsafe-return": "off",
            "typescript/no-unnecessary-condition": "off",
            "typescript/prefer-readonly-parameter-types": "off",
            "typescript/strict-boolean-expressions": "off",
            "unicorn/import-style": "off",
            "unicorn/no-process-exit": "off",
            "unicorn/prefer-type-error": "off",
          },
        },
        {
          // Tests intentionally use explicit test-runner imports and parent-relative source paths.
          files: testSources,
          plugins: [
            "eslint",
            "react",
            "unicorn",
            "typescript",
            "oxc",
            "import",
            "jsdoc",
            "vitest",
            "jsx-a11y",
            "nextjs",
            "react-perf",
            "promise",
            "node",
            "vue",
          ],
          rules: {
            "import/no-nodejs-modules": [
              "error",
              {
                allow: [
                  "node:child_process",
                  "node:fs",
                  "node:fs/promises",
                  "node:os",
                  "node:path",
                  "node:url",
                ],
              },
            ],
            "import/no-relative-parent-imports": "off",
            "jest/max-expects": ["error", { max: 10 }],
            "jest/no-conditional-expect": "off",
            "jest/no-conditional-in-test": "off",
            "jest/prefer-ending-with-an-expect": "off",
            "jest/prefer-expect-assertions": "off",
            "jest/prefer-strict-equal": "off",
            "jest/require-top-level-describe": "off",
            "jest/valid-expect": ["error", { maxArgs: 2 }],
            "vitest/max-expects": ["error", { max: 10 }],
            "vitest/no-importing-vitest-globals": "off",
            "vitest/valid-expect": ["error", { maxArgs: 2 }],
          },
        },
        {
          files: bindingSources,
          rules: {
            // Boundary tests intentionally use async cases and compact numeric fixtures.
            // They also drive a deliberately tiny trapping guest.
            "eslint/func-style": "off",
            "eslint/id-length": "off",
            "eslint/max-lines-per-function": "off",
            "eslint/max-statements": "off",
            "eslint/no-duplicate-imports": "off",
            "eslint/no-magic-numbers": "off",
            "eslint/no-ternary": "off",
            "eslint/no-undefined": "off",
            "eslint/no-void": "off",
            "eslint/one-var": "off",
            "eslint/sort-imports": "off",
            "eslint/sort-vars": "off",
            "oxc/no-async-await": "off",
            "typescript/no-unsafe-type-assertion": "off",
            "unicorn/consistent-function-scoping": "off",
          },
        },
        {
          files: vectorSources,
          rules: {
            // Frozen-vector replay is declarative fixture code.
            // It filters records on purpose, preserves JSON nulls, and runs data-driven loops.
            "eslint/eqeqeq": "off",
            "eslint/func-style": "off",
            "eslint/max-lines": "off",
            "eslint/max-lines-per-function": "off",
            "eslint/max-statements": "off",
            "eslint/no-continue": "off",
            "eslint/no-magic-numbers": "off",
            "eslint/no-ternary": "off",
            "eslint/no-undefined": "off",
            "eslint/one-var": "off",
            "eslint/sort-imports": "off",
            "eslint/sort-vars": "off",
            "jsdoc/require-param": "off",
            "jsdoc/require-returns": "off",
            "oxc/no-async-await": "off",
            "oxc/no-optional-chaining": "off",
            "typescript/no-unsafe-type-assertion": "off",
            "typescript/non-nullable-type-assertion-style": "off",
            "typescript/prefer-readonly-parameter-types": "off",
            "unicorn/consistent-function-scoping": "off",
            "unicorn/import-style": "off",
            "unicorn/no-array-callback-reference": "off",
            "unicorn/no-array-sort": "off",
            "unicorn/no-null": "off",
            "vitest/no-conditional-expect": "off",
            "vitest/no-conditional-in-test": "off",
          },
        },
        {
          files: configSources,
          rules: {
            // A configuration module is a declaration, not an implementation.
            // It default-exports the shape a tool expects.
            // It exports several named things on purpose.
            // A base reachable only through one symbol cannot be extended.
            // A rule table is long and repetitive by nature.
            // The rules that keep implementation files readable have nothing to say about it.
            "eslint/func-style": "off",
            "eslint/max-lines": "off",
            "eslint/max-lines-per-function": "off",
            "eslint/sort-keys": "off",
            "eslint/sort-vars": "off",
            "import/exports-last": "off",
            "import/group-exports": "off",
            "import/no-default-export": "off",
            "import/no-named-export": "off",
            // A package's config has to reach the shared base at the repository root.
            // So this rule is unsatisfiable for exactly the files that avoid duplicating a config.
            // The alternative is a published package holding one file.
            // That trades a real coupling problem for a worse one.
            "import/no-relative-parent-imports": "off",
          },
        },
      ],
      plugins: [...lintPlugins],
      rules: {
        // The automatic JSX transform has been the default since React 17.
        // Requiring `React` in scope is a false positive on every JSX file in a modern app.
        // The `react` plugin's correctness category switches the rule on.
        // This repository is on React 19.
        "react/react-in-jsx-scope": "off",
        // `fmt.sortImports` and `eslint/sort-imports` are two authorities for one decision.
        // They disagree: the formatter sorts by module specifier, the rule sorts by member name.
        // Leaving both on makes `vp fmt` and `vp lint` fight over import order.
        // So `vp fmt` rewrites a line and `vp lint` reports it again.
        // The formatter wins, because it is deterministic and runs inside `vp check`.
        // The linter must never contradict it.
        "eslint/sort-imports": "off",
        "typescript/await-thenable": "error",
        "typescript/no-floating-promises": "error",
        "typescript/no-misused-promises": "error",
        "typescript/no-unsafe-argument": "error",
        "typescript/no-unsafe-assignment": "error",
        "typescript/no-unsafe-member-access": "error",
        "typescript/no-unsafe-return": "error",
        "typescript/unbound-method": "error",
        "vitest/no-disabled-tests": "error",
        "vitest/no-focused-tests": "error",
      },
    },
  };

export default defineConfig({
  ...toolchain,
  pack: {
    clean: true,
    deps: {
      // Preserve pre-tsdown 0.23 external subpath resolution.
      neverBundle: [/^node:/u],
      resolveDepSubpath: true,
    },
    dts: {
      sourcemap: true,
    },
    // Root-level commands target the package by its workspace path.
    entry: ["packages/colander/src/index.ts"],
    format: ["esm"],
    outDir: "packages/colander/dist",
    platform: "neutral",
    sourcemap: true,
    target: "es2022",
    unbundle: true,
  },
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts"],
  },
});
