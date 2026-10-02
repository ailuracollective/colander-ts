// This module materializes one commit of a core repository into a build directory. It never
// Mutates the source repository: a local repository is exported read-only with `git archive`, and a
// Remote is fetched into an isolated temporary directory.
/* eslint-disable import/no-default-export */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const GIT_TIMEOUT_MS = 120_000,
  GIT_MAX_BUFFER = 16 * 1024 * 1024,
  MANIFEST_NAME = "Cargo.toml",
  ONE_ENTRY = 1;

/** The local export is a plain directory, so its resolved commit is recorded as it is produced.
 * @type {Map<string, string>} */
const resolvedCommits = new Map();

/**
 * Materializes the selected commit of a repository into `destination`.
 *
 * @param {{ repository: string, ref: string, isLocal: boolean, destination: string }} request the
 * repository to read, the commit, tag, or branch to resolve, and the directory to populate
 * @returns {Promise<MaterializedSource>} the populated directory and the resolved commit
 */
async function materializeGitSource({ destination, isLocal, ref, repository }) {
  await mkdir(destination, { recursive: true });
  const exportedRoot = isLocal
    ? materializeLocalRepository({ destination, ref, repository })
    : materializeRemoteRepository({ destination, ref, repository });
  const workingDirectory = await resolveCrateRoot(exportedRoot);
  return { commit: resolveCommit(exportedRoot), directory: workingDirectory };
}

/**
 * Exports a local repository without touching its working tree, index, or refs.
 *
 * @param {{ repository: string, ref: string, destination: string }} request the checkout to read
 * @returns {string} the directory the tree was exported into
 */
function materializeLocalRepository({ destination, ref, repository }) {
  const root = join(destination, "source"),
    archivePath = join(destination, "source.tar"),
    commit = runGit(["rev-parse", `${ref}^{commit}`], { cwd: repository });
  // `--output` keeps the export entirely on git's side: nothing is streamed through this process.
  runGit(["archive", "--format=tar", `--output=${archivePath}`, ref], { cwd: repository });
  mkdirSync(root, { recursive: true });
  runTar(archivePath, root);
  resolvedCommits.set(root, commit);
  return root;
}

/**
 * Fetches exactly one commit of a remote repository into an isolated directory.
 *
 * @param {{ repository: string, ref: string, destination: string }} request the remote to read
 * @returns {string} the directory the commit was checked out into
 */
function materializeRemoteRepository({ destination, ref, repository }) {
  const root = join(destination, "clone");
  // The clone lives in the build's own temporary directory, never in the source repository.
  runGit(["init", "--quiet", root], { cwd: destination });
  runGit(["remote", "add", "origin", repository], { cwd: root });
  // A single shallow fetch of the ref: full history is never transferred.
  runGit(["fetch", "--quiet", "--depth", "1", "origin", ref], { cwd: root });
  runGit(["checkout", "--quiet", "FETCH_HEAD"], { cwd: root });
  return root;
}

/**
 * Unpacks an exported tar tree into a directory, using git's own extractor so no entry name is ever
 * interpreted by this process.
 *
 * @param {string} archivePath the exported tar
 * @param {string} destination the directory to unpack into
 * @returns {void}
 */
function runTar(archivePath, destination) {
  try {
    execFileSync("tar", ["-xf", archivePath, "-C", destination], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not unpack the exported tree: ${detail}`);
  }
}

/**
 * Resolves the ref to a full commit SHA. The local export is not a checkout, so the source
 * repository is asked; the remote case is a real checkout, so its own HEAD answers.
 *
 * @param {string} workingDirectory the materialized tree
 * @returns {string} the full commit SHA
 */
function resolveCommit(workingDirectory) {
  if (resolvedCommits.has(workingDirectory)) {
    // Recorded when the local export was produced, because an export is not a checkout.
    const recorded = resolvedCommits.get(workingDirectory) ?? "";
    return recorded;
  }
  if (existsSync(join(workingDirectory, ".git"))) {
    return runGit(["rev-parse", "HEAD"], { cwd: workingDirectory });
  }
  throw new Error(`could not resolve the materialized commit at ${workingDirectory}`);
}

/**
 * Locates the crate inside a materialized commit.
 *
 * Two shapes are accepted, and only two: the commit *is* the crate, or the commit's whole content is
 * one crate directory. Anything else is a repository this build cannot resolve, and guessing inside
 * it would compile whichever crate happened to sort first.
 *
 * @param {string} exportedRoot the materialized tree
 * @returns {Promise<string>} the directory holding the crate manifest
 */
async function resolveCrateRoot(exportedRoot) {
  if (await isFile(join(exportedRoot, MANIFEST_NAME))) {
    return exportedRoot;
  }
  const entries = await readdir(exportedRoot, { withFileTypes: true });
  if (entries.length === ONE_ENTRY) {
    const [only] = entries;
    if (only?.isDirectory()) {
      const nested = join(exportedRoot, only.name);
      if (await isFile(join(nested, MANIFEST_NAME))) {
        return nested;
      }
    }
  }
  throw new Error(
    `the materialized commit has no ${MANIFEST_NAME} at its root, so it is not a crate repository. ` +
      `Point the git origin at the repository that contains the crate, not at a monorepo root.`,
  );
}

/**
 * @param {string} target the path to inspect
 * @returns {Promise<boolean>} whether it is a regular file
 */
async function isFile(target) {
  try {
    const stats = await stat(target);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * @param {readonly string[]} arguments_ the git arguments
 * @param {{ cwd: string }} options the working directory
 * @returns {string} trimmed stdout
 */
function runGit(arguments_, { cwd }) {
  try {
    return execFileSync("git", arguments_, {
      cwd,
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${arguments_.join(" ")} failed: ${detail}`);
  }
}

const gitSource = { materializeGitSource };

export default gitSource;

/** @typedef {{ directory: string, commit: string }} MaterializedSource */
