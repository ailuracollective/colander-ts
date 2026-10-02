import { defineConfig } from "vite-plus";

// This package owns its `pack` and `test` configuration.
// Both are package-relative and cannot be expressed at the workspace root.
// It deliberately has no `lint` or `fmt` block.
// Vite+ applies the root configuration here.
// The root uses `overrides` for anything package-specific.
// A package-level lint block would replace the root rules rather than extend them.
export default defineConfig({
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
    entry: ["src/index.ts"],
    format: ["esm"],
    outDir: "dist",
    platform: "neutral",
    sourcemap: true,
    target: "es2022",
    unbundle: true,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
