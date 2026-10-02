// The pre-publication audit: what npm would publish, checked without publishing anything.
//
// This used to pack a `.tgz` and read it back, and that was never needed to publish.
// `npm publish` builds the archive itself from the package directory, so the file was an
// Intermediate nobody consumed, and it made every `dist` rebuild invalidate the tarball digest in
// The consumers' lockfiles.
// What survives is the check, and it runs in two halves:
//
// The manifest half proves that every `main`, `types` and `exports` target exists on disk, that
// `files` covers it, and that the core ships its WebAssembly asset. It names the offending entry.
// The registry half asks npm what it would include, with `npm pack --dry-run --json`, and proves
// Every required entry is in that list.
// That is npm's own inclusion logic, not this script's reading of the manifest, which is the reason
// It is worth running at all. No archive is written.

import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

// The audit is a top-level-await module, not a test file: the top-level `await`s below are the
// Program itself, and the hook rule exists for suites.
/* eslint-disable jest/require-hook, vitest/require-hook */

const packageDirectory = process.cwd();
const manifest = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"));

/**
 * @param {string} message the reason the package cannot be published
 * @returns {Error} an error naming the package
 */
function packageError(message) {
  return new Error(`Cannot publish ${manifest.name}@${manifest.version}: ${message}`);
}

/**
 * @param {string} path a filesystem path
 * @returns {Promise<void>}
 */
async function assertNonEmptyFile(path) {
  try {
    const fileStats = await stat(path);
    if (!fileStats.isFile() || fileStats.size === 0) {
      throw new Error("not a non-empty file");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw packageError(`${path} is missing or empty (${reason}). Run the package build first.`);
  }
}

/**
 * @param {unknown} value one `exports` entry
 * @param {string} [path] the manifest path of that entry
 * @returns {readonly { path: string, target: string }[]} every relative target it names
 */
function collectExportTargets(value, path = "exports") {
  if (typeof value === "string") {
    return [{ path, target: value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => collectExportTargets(child, `${path}[${index}]`));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    collectExportTargets(child, `${path}.${key}`),
  );
}

/**
 * Checks that one published target exists, stays inside the package, and is covered by `files`.
 *
 * The `files` half is the reason this script exists: an export target that resolves in a workspace
 * but is missing from the published archive is invisible until a consumer installs the package.
 *
 * @param {{ path: string, target: string }} exportTarget the manifest entry to check
 * @returns {Promise<string>} the package-relative path the archive must contain
 */
async function assertExportTarget({ path, target }) {
  if (!target.startsWith("./")) {
    throw packageError(`${path} must point to a relative ./ path (received ${target})`);
  }
  const relativePath = target.slice(2);
  const filePath = resolve(packageDirectory, relativePath);
  const relativeToPackage = relative(packageDirectory, filePath).replaceAll("\\", "/");
  if (
    relativeToPackage === ".." ||
    relativeToPackage.startsWith("../") ||
    isAbsolute(relativeToPackage)
  ) {
    throw packageError(`${path} escapes the package directory (${target})`);
  }

  await assertNonEmptyFile(filePath);

  if (Array.isArray(manifest.files)) {
    const included = manifest.files.some(
      (pattern) => relativePath === pattern || relativePath.startsWith(`${pattern}/`),
    );
    if (!included) {
      throw packageError(`${path} points outside the declared files list (${target})`);
    }
  }

  return relativePath;
}

const declaredTargets = [
  ...(typeof manifest.main === "string" ? [{ path: "main", target: manifest.main }] : []),
  ...(typeof manifest.types === "string" ? [{ path: "types", target: manifest.types }] : []),
  ...collectExportTargets(manifest.exports),
];
if (declaredTargets.length === 0) {
  throw packageError("the manifest has no main, types, or export targets");
}

const requiredEntries = new Set(["package/package.json"]);
for (const exportTarget of declaredTargets) {
  requiredEntries.add(`package/${await assertExportTarget(exportTarget)}`);
}

if (manifest.name === "@ailura/colander") {
  await assertNonEmptyFile(resolve(packageDirectory, "wasm/colander.wasm"));
  requiredEntries.add("package/wasm/colander.wasm");
}

assertRegistryIncludes(requiredEntries);
console.log(
  `[audit] ${manifest.name}@${manifest.version}: ${declaredTargets.length} published targets audited`,
);

/**
 * Ask npm what it would include, then prove every required entry is in that list.
 *
 * @param {ReadonlySet<string>} expected the entries the package must publish
 * @returns {void}
 */
function assertRegistryIncludes(expected) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // `--ignore-scripts` keeps the audit a pure read: without it, `npm pack` runs the `prepack`
  // Lifecycle, which is where a real publish prepares the output, and the audit would trigger the
  // Build it is trying to inspect.
  const result = spawnSync(
    npm,
    ["pack", "--dry-run", "--ignore-scripts", "--json", "--loglevel=silent"],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw packageError(`could not run npm pack --dry-run (${result.error.message})`);
  }
  if (result.status !== 0) {
    throw packageError(`npm pack --dry-run failed: ${result.stderr.trim()}`);
  }

  // Npm prints its own progress lines before the JSON, so the payload starts at the first bracket.
  const stdout = result.stdout;
  const start = stdout.indexOf("[");
  if (start === -1) {
    throw packageError("npm pack --dry-run printed no report");
  }
  const [report] = JSON.parse(stdout.slice(start));
  const included = new Set(report.files.map((file) => `package/${file.path}`));
  const missing = [...expected].filter((entry) => !included.has(entry));
  if (missing.length > 0) {
    throw packageError(
      `npm would not publish: ${missing.join(", ")}. ` +
        "The package contents do not match the current manifest.",
    );
  }
}
