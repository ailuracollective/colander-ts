import { defineConfig } from "vite-plus";

/**
 * The Nest example's own Vite+ configuration.
 *
 * This application is an isolated consumer: it sits outside the pnpm workspace, keeps its own
 * lockfile, and links the built packages by directory so it resolves their real `exports` map. No
 * workspace configuration can reach it, and that is the point — the consumer audit in
 * `scripts/bootstrap-consumers.mjs` depends on this boundary.
 *
 * So this file is deliberately self-contained. It shares no configuration with the workspace,
 * which also means it is not held to the workspace's full rule table: an example exists to prove
 * that a consumer can build against the published packages, and a 500-line style contract is not
 * what that proof requires. What it does enforce is the part that can actually be wrong — code that
 * is incorrect, and code that is suspicious.
 */
export default defineConfig({
  check: {
    fmt: true,
    lint: true,
  },
  fmt: {
    arrowParens: "always",
    endOfLine: "lf",
    ignorePatterns: ["dist/**", "node_modules/**", "**/*.wasm"],
    insertFinalNewline: true,
    printWidth: 100,
    proseWrap: "always",
    quoteProps: "as-needed",
    semi: true,
    singleQuote: false,
    sortImports: true,
    sortPackageJson: {
      sortScripts: true,
    },
    tabWidth: 2,
    trailingComma: "all",
    useTabs: false,
  },
  lint: {
    categories: {
      correctness: "error",
      suspicious: "error",
    },
    env: {
      // A Nest application runs in Node and nowhere else.
      node: true,
    },
    ignorePatterns: ["dist/**", "node_modules/**"],
    options: {
      denyWarnings: true,
      maxWarnings: 0,
      reportUnusedDisableDirectives: "error",
      respectEslintDisableDirectives: true,
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["test/**/*.ts", "src/**/*.spec.ts", "src/**/*.test.ts"],
        plugins: ["vitest"],
        rules: {
          "vitest/no-disabled-tests": "error",
          "vitest/no-focused-tests": "error",
        },
      },
      {
        files: ["vite.config.ts", "vitest.config.ts", "vitest.config.e2e.ts"],
        rules: {
          "eslint/max-lines": "off",
          "import/no-default-export": "off",
        },
      },
    ],
    plugins: ["eslint", "typescript", "oxc", "import", "vitest", "node"],
    rules: {
      // A framework configuration file default-exports what the framework expects.
      "eslint/init-declarations": "off",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/require-await": "error",
    },
  },
});
