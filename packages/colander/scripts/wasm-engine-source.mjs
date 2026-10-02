// The shared engine-source module holds the origin grammar, the digest rules, and every download
// URL, with no filesystem or network IO, so each rule is unit testable. An absent optional value is
// Modelled as an empty string, because this workspace bans the null and undefined literals.
/* eslint-disable import/no-default-export */

import enginePlans from "./wasm-engine-plans.mjs";

const DEFAULT_GITHUB_ASSET = enginePlans.DEFAULT_GITHUB_ASSET,
  TARGET = "wasm32-unknown-unknown",
  SOURCE_VARIABLE = "COLANDER_WASM_SOURCE",
  DIGEST_VARIABLE = "COLANDER_WASM_SHA256";

const REQUIRED_FUNCTIONS = Object.freeze([
    "colander_content_hash",
    "colander_evaluate_rules",
    "colander_next_version",
    "colander_version_info",
    "colander_abi_version",
    "colander_free_string",
    "colander_validate_schema",
    "colander_alloc",
    "colander_free_buffer",
    "colander_compile",
    "colander_validate_response",
  ]),
  REMOVED_FUNCTION = "colander_last_panic",
  DIGEST_PATTERN = /^[0-9a-f]{64}$/u,
  ACCEPTED_FORMS = [
    "github:<owner>/<repo>@<release-tag>[!<asset>] (for example github:ailuracollective/colander@v1.0.0)",
    "path:<file.wasm|directory> (for example path:../colander-rs)",
    "git:<repository>@<commit|tag|branch> (for example git:../colander-rs@d54a86e)",
  ].join("; ");

/**
 * Parses one engine-origin spec into a resolution plan.
 *
 * There is no default origin. Every scheme that names a published artifact is either dead or
 * unverifiable, so a build that does not say where the engine comes from has nothing to build and
 * says so instead of guessing.
 *
 * @param {string} rawSource the raw `COLANDER_WASM_SOURCE` value
 * @returns {import("./wasm-engine-plans.mjs").GithubPlan | import("./wasm-engine-plans.mjs").PathPlan | import("./wasm-engine-plans.mjs").GitPlan} the plan
 */
function parseEngineSource(rawSource) {
  const normalized = rawSource.trim(),
    separator = normalized.indexOf(":"),
    scheme = separator === -1 ? "" : normalized.slice(0, separator).toLowerCase(),
    reference = separator === -1 ? "" : normalized.slice(separator + 1).trim();
  if (scheme === "" || reference === "") {
    throw sourceError(`missing origin. Expected ${ACCEPTED_FORMS}`);
  }
  if (scheme === "github") {
    return enginePlans.parseGithubPlan(reference);
  }
  if (scheme === "path") {
    return enginePlans.parsePathPlan(reference);
  }
  if (scheme === "git") {
    return enginePlans.parseGitPlan(reference);
  }
  throw sourceError(`unknown origin ${JSON.stringify(scheme)}. Expected ${ACCEPTED_FORMS}`);
}

/**
 * Parses the optional expected engine artifact digest.
 *
 * @param {string} rawDigest the raw `COLANDER_WASM_SHA256` value
 * @returns {string} the lowercase digest, or an empty string when the variable is unset or blank
 */
function parseExpectedArtifactSha256(rawDigest) {
  const digest = rawDigest.trim().toLowerCase();
  if (digest === "") {
    return "";
  }
  if (!DIGEST_PATTERN.test(digest)) {
    throw new Error(
      `${DIGEST_VARIABLE} must be 64 hexadecimal characters, got ${JSON.stringify(rawDigest)}. ` +
        `Remove the variable to accept the artifact without an explicit digest.`,
    );
  }
  return digest;
}

/**
 * Enforces the release-only integrity gate.
 *
 * Every origin needs an explicit digest in a release build. There is no in-code digest to fall back
 * on: the crate origin that carried one is gone, and a local checkout has no fixed bytes to pin
 * until the caller states them.
 *
 * @param {{ plan: EnginePlan, expectedSha256: string, requireDigest: boolean }} request the resolved
 * plan, the expected artifact digest (empty when unset), and whether the release build requires one
 * @returns {void}
 */
function assertReleaseDigestSatisfied({ expectedSha256, plan, requireDigest }) {
  if (!requireDigest || expectedSha256) {
    return;
  }
  throw new Error(
    `${DIGEST_VARIABLE} is required for the release build of a ${plan.kind} origin. Set it to the ` +
      `64-character SHA-256 of the expected engine artifact.`,
  );
}

/**
 * Collects the export names of a compiled module.
 *
 * @param {WebAssembly.Module} compiledModule the compiled engine module
 * @returns {Set<string>} every exported name
 */
function collectModuleExportNames(compiledModule) {
  return new Set(WebAssembly.Module.exports(compiledModule).map(({ name }) => name));
}

/**
 * Asserts the engine export contract that every origin must satisfy.
 *
 * @param {Set<string>} exportNames the exported names of the candidate module
 * @returns {void}
 */
function assertRequiredExports(exportNames) {
  for (const name of REQUIRED_FUNCTIONS) {
    if (!exportNames.has(name)) {
      throw new Error(`built module does not export ${name}()`);
    }
  }
  if (exportNames.has(REMOVED_FUNCTION)) {
    throw new Error(`built module unexpectedly exports the removed ${REMOVED_FUNCTION}()`);
  }
}

/**
 * Renders one resolved plan for the build log.
 *
 * @param {EnginePlan} plan the resolved origin
 * @returns {string} a short human-readable origin label
 */
function describePlan(plan) {
  if (plan.kind === "github") {
    return `github ${plan.owner}/${plan.repository}@${plan.ref}`;
  }
  if (plan.kind === "git") {
    return `git ${plan.repository}@${plan.ref}`;
  }
  return `path ${plan.target}`;
}

/**
 * @param {string} message the reason the spec was rejected
 * @returns {Error} an actionable error naming the source variable
 */
function sourceError(message) {
  return new Error(`${SOURCE_VARIABLE}: ${message}`);
}

const wasmEngineSource = {
  DEFAULT_GITHUB_ASSET,
  DIGEST_VARIABLE,
  REMOVED_FUNCTION,
  REQUIRED_FUNCTIONS,
  SOURCE_VARIABLE,
  TARGET,
  assertReleaseDigestSatisfied,
  assertRequiredExports,
  collectModuleExportNames,
  describePlan,
  parseEngineSource,
  parseExpectedArtifactSha256,
};

export default wasmEngineSource;

/** @typedef {import("./wasm-engine-plans.mjs").GithubPlan | import("./wasm-engine-plans.mjs").PathPlan | import("./wasm-engine-plans.mjs").GitPlan} EnginePlan */
