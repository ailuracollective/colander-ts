#!/usr/bin/env node
/**
 * `colander generate` and `colander check`.
 *
 * The mapping now lives in a directory of files named after the types, and the
 * plugin is told where. This command takes that same information as flags, so it
 * needs no bundler and no configuration file: it reads a directory and writes
 * files, which is all either command does.
 *
 *   colander generate --components-dir src/components/colander \
 *                     --shell src/components/colander/shell
 *
 *   colander check    --components-dir …
 *
 * The tree lands in the same fixed directory the bundler plugin writes, so
 * `--out-dir` is an override for the unusual case, never a requirement.
 *
 * A command that worked prints nothing and exits 0: a generation that succeeded
 * and a `check` that found the tree current have nothing to report. Everything
 * that does go to the console goes to stderr, and every one of those lines comes
 * with a non-zero exit.
 */

import { existsSync } from "node:fs";
import process from "node:process";

/** Must match the plugin's `GENERATED_DIR_NAME`; the tree has one fixed home. */
const GENERATED_DIR_NAME = ".colander";

import { discoverComponents, mappingFromDiscovery } from "../dist/discover.js";
import { findStaleGeneratedFiles, generateComponents } from "../dist/generate.js";

const FLAGS = {
    "--components-dir": "componentsDir",
    "--omit": "omit",
    "--out-dir": "outDir",
    "--shell": "shell",
  },
  USAGE = `Usage: colander <generate|check> --components-dir <dir> --shell <file> [--out-dir <dir>] [--omit <types>]`;

/** The command, the flags, and the types the consumer omits. */
function readArguments(argv) {
  const command = argv[0] ?? "generate",
    options = { omit: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index],
      key = FLAGS[token],
      value = argv[index + 1];
    if (key === undefined || value === undefined) {
      console.error(`[colander] \`${token}\` is not a flag this command knows.`);
      console.error(USAGE);
      process.exit(2);
    }
    options[key] =
      key === "omit"
        ? value
            .split(",")
            .map((type) => type.trim())
            .filter(Boolean)
        : value;
    index += 1;
  }
  return { command, options };
}

const { command, options } = readArguments(process.argv.slice(2));

if (command !== "generate" && command !== "check") {
  console.error(USAGE);
  process.exit(2);
}

if (options.componentsDir === undefined) {
  console.error(
    `[colander] --components-dir is required: it is the directory of one file per type.`,
  );
  process.exit(2);
}

const outDir = options.outDir ?? GENERATED_DIR_NAME;

/** The options a generation takes, discovered from the directory the flags name. */
async function resolveOptions() {
  if (options.shell !== undefined && !existsSync(options.shell)) {
    for (const extension of [".tsx", ".ts"]) {
      if (existsSync(`${options.shell}${extension}`)) {
        break;
      }
    }
  }
  const discovery = await discoverComponents({
    componentsDir: options.componentsDir,
    importer: `${outDir}/controls.ts`,
    omit: options.omit,
    shell: options.shell,
  });
  return {
    outDir,
    ...mappingFromDiscovery(discovery),
  };
}

let resolved;
try {
  resolved = await resolveOptions();
} catch (error) {
  console.error(`[colander] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (command === "check") {
  const stale = await findStaleGeneratedFiles(resolved);
  if (stale.length === 0) {
    process.exit(0);
  }
  console.error(`[colander] the generated tree in ${outDir} is stale: ${stale.join(", ")}.`);
  console.error(
    "[colander] run `colander generate`; the tree is a build artifact, so commit nothing.",
  );
  process.exit(1);
}

await generateComponents(resolved);
process.exit(0);
