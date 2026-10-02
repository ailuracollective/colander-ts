// The cargo and download helpers are process-bound IO, kept apart from the origin grammar so each
// File stays one concern.
/* eslint-disable import/no-default-export */

import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const TARGET = "wasm32-unknown-unknown",
  DOWNLOAD_TIMEOUT_MS = 120_000,
  PROCESS_MAX_BUFFER = 16 * 1024 * 1024,
  MANIFEST_NAME = "Cargo.toml",
  ARTIFACT_SUFFIX = ".wasm",
  FIRST = 0;

/**
 * Compiles a crate directory to wasm32-unknown-unknown and returns the built artifact path.
 *
 * @param {string} crateRoot the crate directory containing Cargo.toml
 * @param {string} libName the expected library name, empty when it must be discovered
 * @param {string} root the temporary root that owns the cargo target directory
 * @returns {Promise<string>} the built artifact path
 */
async function buildCrateArtifact(crateRoot, libName, root) {
  const targetDirectory = join(root, "target"),
    releaseDirectory = join(targetDirectory, TARGET, "release");
  runCommand(
    "cargo",
    [
      "build",
      "--manifest-path",
      join(crateRoot, MANIFEST_NAME),
      "--target",
      TARGET,
      "--release",
      "--locked",
    ],
    { cwd: root, env: { ...process.env, CARGO_TARGET_DIR: targetDirectory } },
  );
  const entries = await readdir(releaseDirectory, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(ARTIFACT_SUFFIX))
    .map((entry) => entry.name)
    // Sorted for a deterministic error message; `toSorted` is unavailable on this es2022 target.
    // eslint-disable-next-line unicorn/no-array-sort
    .sort();
  const [firstCandidate = ""] = candidates;
  if (firstCandidate === "") {
    throw new Error(`cargo produced no ${ARTIFACT_SUFFIX} artifact in ${releaseDirectory}`);
  }
  const expectedName = libName === "" ? "" : `${libName}${ARTIFACT_SUFFIX}`;
  if (expectedName !== "" && !candidates.includes(expectedName)) {
    throw new Error(
      `cargo did not produce ${expectedName} in ${releaseDirectory}; found ${candidates.join(", ")}`,
    );
  }
  return join(releaseDirectory, expectedName === "" ? firstCandidate : expectedName);
}

/**
 * Fetches one artifact over the network.
 *
 * @param {string} url the absolute download URL
 * @param {string} label the human-readable name of the artifact, for the log line
 * @returns {Promise<Buffer>} the downloaded bytes
 */
async function downloadBytes(url, label) {
  console.log(`Downloading ${label} from ${url}`);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Runs a child process with the build's own stdio, so cargo's progress reaches the terminal.
 *
 * @param {string} command the executable
 * @param {readonly string[]} arguments_ the arguments
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options] the working directory and environment
 * @returns {void}
 */
function runCommand(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    maxBuffer: PROCESS_MAX_BUFFER,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? FIRST}`);
  }
}

const cargoBuild = { TARGET, buildCrateArtifact, downloadBytes, runCommand };

export default cargoBuild;
