import path from "node:path";

import { colander } from "@ailura/colander-compiler";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import { colanderOptions } from "./src/lib/colander-options.js";

/**
 * The React example's own Vite+ configuration.
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

// https://vite.dev/config/
export default defineConfig({
  check: {
    fmt: true,
    lint: true,
  },
  fmt: {
    arrowParens: "always",
    endOfLine: "lf",
    // `routeTree.gen.ts` and `.colander/` are written by TanStack Router and by
    // `colander generate`. Both rewrite those files wholesale, so formatting them would only
    // produce a diff the next build undoes.
    ignorePatterns: ["dist/**", "node_modules/**", ".colander/**", "src/routeTree.gen.ts"],
    insertFinalNewline: true,
    printWidth: 100,
    proseWrap: "always",
    quoteProps: "as-needed",
    semi: true,
    singleQuote: false,
    sortImports: true,
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
      browser: true,
    },
    ignorePatterns: ["dist/**", "node_modules/**", ".colander/**"],
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
        files: ["src/**/*.test.ts", "src/**/*.spec.ts"],
        plugins: ["vitest"],
        rules: {
          "vitest/no-disabled-tests": "error",
          "vitest/no-focused-tests": "error",
        },
      },
      {
        files: ["vite.config.ts", "vitest.config.ts"],
        rules: {
          "eslint/max-lines": "off",
          "import/no-default-export": "off",
        },
      },
    ],
    plugins: ["eslint", "react", "typescript", "oxc", "import", "vitest"],
    rules: {
      // The automatic JSX transform has been the default since React 17, so requiring `React` in
      // scope is a false positive on every JSX file. The `react` plugin's correctness category
      // switches the rule on, and this project is on React 19.
      "react/react-in-jsx-scope": "off",
      "react/rules-of-hooks": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/require-await": "error",
    },
  },
  plugins: [tanstackStart(), react(), tailwindcss(), colander(colanderOptions)],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    // The colander packages are linked by directory rather than installed from a registry, so the
    // engine asset resolves to a real path outside this app's root and the dev server refuses to
    // serve it. A consumer that links the package needs the same allowance.
    fs: {
      allow: [path.resolve(import.meta.dirname, "../..")],
    },
    /**
     * The backend is mounted at `/api` and owns that path itself
     * (`app.setGlobalPrefix("api")` in `examples/nest-app/src/main.ts`).
     *
     * This proxy used to strip `/api` before forwarding, which is what made the
     * documented `/api/…` contract true while the application served the root —
     * the prefix lived in the dev proxy instead of in the app, so any other
     * consumer would have had to strip it too, and the e2e specs had to mount the
     * app with a prefix the real boot did not use. Now the path is passed through
     * untouched, and the proxy only says where the backend is.
     */
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
