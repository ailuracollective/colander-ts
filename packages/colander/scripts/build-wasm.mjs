// The engine build: one resolved origin in, one verified wasm artifact out.
//
// The origin grammar, the digest rules and the export contract live in `wasm-engine-source.mjs`.
// The process-bound IO lives in `cargo-build.mjs`; `git-source.mjs` materializes the `git:` origin.
// This file is only the orchestration: resolve, obtain, verify, validate and install.
//
// Two rules hold for every origin.
// Nothing reaches the output path until the artifact passes its digest and its export contract.
// A failure exits non-zero with the reason on stderr, because this script runs in `prepack`.

import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import cargoBuild from "./cargo-build.mjs";
import gitSource from "./git-source.mjs";
import engineSource from "./wasm-engine-source.mjs";

const { buildCrateArtifact, downloadBytes } = cargoBuild,
  { assertRequiredExports, collectModuleExportNames, describePlan, parseEngineSource } =
    engineSource,
  PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url)),
  OUTPUT_VARIABLE = "COLANDER_WASM_OUTPUT",
  DEFAULT_OUTPUT = join(PACKAGE_ROOT, "wasm", "colander.wasm"),
  RELEASE_FLAG = "--require-digest",
  TEMPORARY_PREFIX = "colander-wasm-",
  ARTIFACT_NAME = "engine.wasm",
  EXIT_FAILURE = 1,
  EMPTY = "";

/**
 * Obtains the engine artifact the plan names, in a temporary directory that is removed afterwards.
 *
 * @param {EnginePlan} plan the resolved origin
 * @param {string} temporaryRoot the build's own directory
 * @returns {Promise<string>} the path of the obtained artifact
 */
async function obtainArtifact(plan, temporaryRoot) {
  if (plan.kind === "github") {
    const label = `${plan.owner}/${plan.repository} ${plan.asset}`;
    const artifact = await downloadArtifact(temporaryRoot, plan.downloadUrl, label);
    return artifact;
  }
  if (plan.kind === "git") {
    const artifact = await buildFromGitSource(plan, temporaryRoot);
    return artifact;
  }
  const artifact = await resolveLocalTarget(plan, temporaryRoot);
  return artifact;
}

/**
 * Materializes the requested commit of a repository and compiles the crate at its root.
 *
 * @param {GitPlan} plan the resolved git origin
 * @param {string} temporaryRoot the build's own directory
 * @returns {Promise<string>} the compiled artifact path
 */
async function buildFromGitSource(plan, temporaryRoot) {
  const source = await gitSource.materializeGitSource({
    destination: temporaryRoot,
    isLocal: plan.isLocal,
    ref: plan.ref,
    repository: plan.repository,
  });
  console.log(`Engine source commit ${source.commit}`);
  return buildCrateArtifact(source.directory, EMPTY, temporaryRoot);
}

/**
 * Uses a local target: a ready module is taken as it is, a crate directory is compiled.
 *
 * @param {PathPlan} plan the resolved path origin
 * @param {string} temporaryRoot the build's own directory
 * @returns {Promise<string>} the artifact path
 */
async function resolveLocalTarget(plan, temporaryRoot) {
  const target = resolvePath(plan.target);
  if (plan.looksLikeModule) {
    if (!(await isFile(target))) {
      throw new Error(`the path origin ${target} is neither a .wasm file nor a crate directory.`);
    }
    return target;
  }
  if (!(await isDirectory(target))) {
    throw new Error(`the path origin ${target} is neither a .wasm file nor a crate directory.`);
  }
  if (!(await isFile(join(target, "Cargo.toml")))) {
    throw new Error(`the path origin ${target} is a directory without Cargo.toml.`);
  }
  return buildCrateArtifact(target, EMPTY, temporaryRoot);
}

/**
 * Downloads one release asset into the build directory.
 *
 * @param {string} temporaryRoot the build's own directory
 * @param {string} url the release asset URL
 * @param {string} label the human-readable artifact name, for the log line
 * @returns {Promise<string>} the downloaded artifact path
 */
async function downloadArtifact(temporaryRoot, url, label) {
  const artifactPath = join(temporaryRoot, ARTIFACT_NAME);
  await writeFile(artifactPath, await downloadBytes(url, label));
  return artifactPath;
}

/**
 * The digest of the bytes this build produced.
 *
 * @param {string} artifactPath the artifact to digest
 * @returns {Promise<string>} the lowercase hexadecimal digest
 */
async function digestOfFile(artifactPath) {
  return digestOfBytes(await readFile(artifactPath));
}

/**
 * @param {Buffer} bytes the bytes to digest
 * @returns {string} the lowercase hexadecimal digest
 */
function digestOfBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Compares the produced artifact with the expected digest, and reports both when they differ.
 *
 * @param {{ actual: string, expected: string }} request the produced and expected digests
 * @returns {void}
 */
function assertArtifactDigest({ actual, expected }) {
  if (expected === EMPTY) {
    return;
  }
  if (actual !== expected) {
    throw new Error(`engine artifact SHA-256 mismatch: expected ${expected}, got ${actual}.`);
  }
  console.log(`Verified engine artifact SHA-256 ${actual}`);
}

/**
 * Rejects an artifact that is not a colander engine, before it can replace one.
 *
 * @param {string} artifactPath the candidate artifact
 * @returns {Promise<void>}
 */
async function assertEngineModule(artifactPath) {
  let compiledModule;
  try {
    compiledModule = await WebAssembly.compile(await readFile(artifactPath));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`the engine artifact is an invalid WebAssembly module: ${detail}`);
  }
  assertRequiredExports(collectModuleExportNames(compiledModule));
  console.log("Engine module exports the pinned surface");
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
 * @param {string} target the path to inspect
 * @returns {Promise<boolean>} whether it is a directory
 */
async function isDirectory(target) {
  try {
    const stats = await stat(target);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * The output path, from the environment or the package default.
 *
 * @returns {string} the absolute output path
 */
function resolveOutput() {
  const configured = (process.env[OUTPUT_VARIABLE] ?? EMPTY).trim();
  return configured === EMPTY ? DEFAULT_OUTPUT : resolvePath(configured);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const plan = parseEngineSource(process.env[engineSource.SOURCE_VARIABLE] ?? EMPTY),
    expectedSha256 = engineSource.parseExpectedArtifactSha256(
      process.env[engineSource.DIGEST_VARIABLE] ?? EMPTY,
    ),
    requireDigest = process.argv.slice(2).includes(RELEASE_FLAG),
    output = resolveOutput();
  engineSource.assertReleaseDigestSatisfied({ expectedSha256, plan, requireDigest });
  console.log(`Engine origin: ${describePlan(plan)}`);
  const temporaryRoot = await mkdtemp(join(tmpdir(), TEMPORARY_PREFIX));
  try {
    const artifactPath = await obtainArtifact(plan, temporaryRoot);
    assertArtifactDigest({ actual: await digestOfFile(artifactPath), expected: expectedSha256 });
    await assertEngineModule(artifactPath);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(artifactPath, output);
    console.log(`Wrote ${output}`);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = EXIT_FAILURE;
}

/** @typedef {import("./wasm-engine-source.mjs").EnginePlan} EnginePlan */
/** @typedef {import("./wasm-engine-plans.mjs").GitPlan} GitPlan */
/** @typedef {import("./wasm-engine-plans.mjs").PathPlan} PathPlan */
