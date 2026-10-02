// The isolated consumer audit: prove the examples work against the built packages.
//
// A consumer is a separate project with its own toolchain and lockfile, deliberately outside this
// Workspace and linked to the packages by directory.
// It resolves `@ailura/colander-client` through the package's own `exports`, so it imports
// `dist` and not the source: rebuilding a package and running the example is a real test of the
// Published shape, and it costs no archive.
//
// What this script no longer does, and why: it used to pack every package into a `.tgz`, install
// That archive into each consumer, and re-derive a SHA-512 of the tarball to compare against the
// Consumer lockfile.
// That made the lockfiles change on every rebuild of `dist`, and made a release format the daily
// Development loop.
// The manifest half of that check, that `files` covers every published target, now runs from
// `audit-package.mjs`, and the registry half asks npm what it would publish, with
// `npm pack --dry-run --json`, so no archive is written either.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageDefinitions = [
  { directory: "packages/colander", name: "@ailura/colander" },
  { directory: "packages/colander-client", name: "@ailura/colander-client" },
  { directory: "packages/colander-browser", name: "@ailura/colander-browser" },
];
const consumers = [
  {
    directory: "examples/nest-app",
    e2e: true,
    packages: ["@ailura/colander"],
  },
  {
    directory: "examples/react-app",
    packages: ["@ailura/colander", "@ailura/colander-client", "@ailura/colander-browser"],
  },
];
const requiredBuildOutputs = {
  "@ailura/colander": ["dist/index.js", "dist/index.d.ts", "wasm/colander.wasm"],
  "@ailura/colander-browser": ["dist/index.js", "dist/index.d.ts"],
  "@ailura/colander-client": ["dist/index.js", "dist/index.d.ts"],
};

/**
 * @param {string} path a path relative to the repository root
 * @returns {string} the absolute path
 */
function fromRoot(path) {
  return resolve(repositoryRoot, path);
}

/**
 * @param {string} path an absolute path
 * @param {string} message what was being checked
 * @returns {Promise<void>}
 */
async function assertNonEmptyFile(path, message) {
  try {
    const fileStats = await stat(path);
    if (!fileStats.isFile() || fileStats.size === 0) {
      throw new Error("not a non-empty file");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} (${reason})`, { cause: error });
  }
}

/**
 * @param {string} path a JSON file
 * @returns {Promise<Record<string, unknown>>} its parsed content
 */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * @param {readonly string[]} arguments_ the command arguments
 * @param {string} cwd the working directory
 * @returns {void}
 */
function run(arguments_, cwd) {
  const result = spawnSync(pnpm, arguments_, { cwd, stdio: "inherit" });
  if (result.error) {
    throw new Error(`Could not start pnpm ${arguments_.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `pnpm ${arguments_.join(" ")} failed with exit code ${result.status ?? "unknown"} in ${cwd}`,
    );
  }
}

/**
 * Every package must have its build output before a consumer can resolve it.
 *
 * @returns {Promise<void>}
 */
async function assertPackagesBuilt() {
  for (const { directory, name } of packageDefinitions) {
    for (const output of requiredBuildOutputs[name] ?? []) {
      await assertNonEmptyFile(
        fromRoot(`${directory}/${output}`),
        `${name} is missing ${output}. Run "pnpm run build" first.`,
      );
    }
  }
}

/**
 * A consumer must depend on the package by directory, not on a copy of it.
 *
 * @param {{ directory: string, packages: readonly string[] }} consumer the consumer to check
 * @returns {Promise<void>}
 */
async function assertConsumerWiring({ directory, packages }) {
  const manifest = await readJson(fromRoot(`${directory}/package.json`));
  for (const packageName of packages) {
    const actual = manifest.dependencies?.[packageName] ?? manifest.devDependencies?.[packageName];
    const expected = `link:../../packages/${packageName.split("/").at(-1)}`;
    if (actual !== expected) {
      throw new Error(
        `${directory}/package.json must reference ${expected} for ${packageName}; ` +
          `found ${actual ?? "no dependency"}. A copy of the package cannot prove the export map.`,
      );
    }
  }
}

/**
 * A consumer must see the built artifact, not the source, through the package's own exports.
 *
 * @param {{ directory: string, packages: readonly string[] }} consumer the consumer to check
 * @returns {Promise<void>}
 */
async function assertResolvedTargets({ directory, packages }) {
  for (const packageName of packages) {
    for (const output of requiredBuildOutputs[packageName] ?? []) {
      await assertNonEmptyFile(
        fromRoot(`${directory}/node_modules/${packageName}/${output}`),
        `${directory} cannot resolve ${packageName}/${output}. Run "pnpm run build" first.`,
      );
    }
  }
}

/**
 * @param {{ directory: string, e2e?: boolean, packages: readonly string[] }} consumer the consumer
 * @returns {Promise<void>}
 */
async function verifyConsumer(consumer) {
  await assertConsumerWiring(consumer);
  run(
    ["install", "--offline", "--frozen-lockfile", "--config.minimum-release-age=0"],
    consumer.directory,
  );
  await assertResolvedTargets(consumer);
  run(["run", "build"], consumer.directory);
  run(["run", "test"], consumer.directory);
  if (consumer.e2e === true) {
    run(["run", "test:e2e"], consumer.directory);
  }
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  for (const consumer of consumers) {
    if (!existsSync(fromRoot(consumer.directory))) {
      throw new Error(`the consumer ${consumer.directory} does not exist`);
    }
  }
  run(
    ["install", "--offline", "--frozen-lockfile", "--config.minimum-release-age=0"],
    repositoryRoot,
  );
  run(["run", "build"], repositoryRoot);
  await assertPackagesBuilt();
  for (const consumer of consumers) {
    await verifyConsumer(consumer);
  }
  run(["run", "test:ssr"], fromRoot("examples/react-app"));
  console.log("\n[bootstrap] isolated consumers build and pass against the built packages");
}

await main();
