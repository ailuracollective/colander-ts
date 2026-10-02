// The per-origin plan builders live here so the grammar module keeps only the public API. Each
// Builder is pure: it validates exactly one spec form and returns the plan the script consumes.
/* eslint-disable import/no-default-export */

const DEFAULT_GITHUB_ASSET = "colander.wasm",
  SOURCE_VARIABLE = "COLANDER_WASM_SOURCE";

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/u,
  GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+$/u,
  // A release tag such as `v1.2.3`, `1.2.3`, or `v1.2.3-rc.1`. A branch name is rejected on
  // Purpose: release assets are only published per tag.
  GITHUB_TAG_PATTERN = /^v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.+-]+)?$/u,
  GITHUB_ASSET_PATTERN = /^[0-9A-Za-z._-]+$/u,
  // A full object name, a tag, or a branch: no path traversal, no shell metacharacters.
  GIT_REF_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._/-]*$/u,
  GIT_URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u,
  MODULE_EXTENSION_PATTERN = /\.wasm$/iu;

/** @param {string} message the reason the spec was rejected
 * @returns {Error} an actionable error naming the source variable */
function sourceError(message) {
  return new Error(`${SOURCE_VARIABLE}: ${message}`);
}

/** @param {string} value the text to inspect
 * @returns {boolean} whether the text contains a control character */
function containsControlCharacter(value) {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) < 32) {
      return true;
    }
  }
  return false;
}

/** @param {string} reference the text after `github:`
 * @returns {GithubPlan} */
function parseGithubPlan(reference) {
  const assetSeparator = reference.indexOf("!"),
    asset =
      assetSeparator === -1 ? DEFAULT_GITHUB_ASSET : reference.slice(assetSeparator + 1).trim(),
    location = assetSeparator === -1 ? reference : reference.slice(0, assetSeparator),
    [repository, ref, ...extraSegments] = location.split("@"),
    [owner, name, ...extraNameSegments] = (repository ?? "").split("/"),
    ownerName = owner ?? "",
    repositoryName = name ?? "",
    releaseTag = ref ?? "";
  if (
    ownerName === "" ||
    repositoryName === "" ||
    extraNameSegments.length > 0 ||
    releaseTag === "" ||
    extraSegments.length > 0
  ) {
    throw sourceError(
      `github origins need <owner>/<repo>@<release-tag>, got ${JSON.stringify(reference)}.`,
    );
  }
  if (!GITHUB_OWNER_PATTERN.test(ownerName) || !GITHUB_REPOSITORY_PATTERN.test(repositoryName)) {
    throw sourceError(
      `github origin ${JSON.stringify(reference)} has an unsupported owner or repository.`,
    );
  }
  if (!GITHUB_TAG_PATTERN.test(releaseTag)) {
    throw sourceError(
      `github origin ${JSON.stringify(reference)} needs a release tag such as v1.2.3, not a ` +
        `branch or commit. Release assets are published per tag.`,
    );
  }
  if (!GITHUB_ASSET_PATTERN.test(asset)) {
    throw sourceError(`github asset ${JSON.stringify(asset)} is not a plain release asset name.`);
  }
  return {
    asset,
    downloadUrl: `https://github.com/${ownerName}/${repositoryName}/releases/download/${releaseTag}/${asset}`,
    kind: "github",
    owner: ownerName,
    ref: releaseTag,
    repository: repositoryName,
  };
}

/** @param {string} reference the text after `path:`
 * @returns {PathPlan} */
function parsePathPlan(reference) {
  if (containsControlCharacter(reference)) {
    throw sourceError("path origins must not contain control characters.");
  }
  const target = reference.trim();
  if (target === "") {
    throw sourceError("path origins need a .wasm file or a crate directory.");
  }
  return { kind: "path", looksLikeModule: MODULE_EXTENSION_PATTERN.test(target), target };
}

/** @param {string} reference the text after `git:`
 * @returns {GitPlan} */
function parseGitPlan(reference) {
  const segments = reference.split("@"),
    repository = segments.slice(0, -1).join("@"),
    ref = segments.at(-1) ?? "";
  if (segments.length < 2 || repository === "" || ref === "") {
    throw sourceError(`git origins need <repository>@<ref>, got ${JSON.stringify(reference)}.`);
  }
  if (containsControlCharacter(repository)) {
    throw sourceError("git origins must not contain control characters in the repository.");
  }
  if (!GIT_REF_PATTERN.test(ref) || ref.includes("..") || ref.endsWith("/")) {
    throw sourceError(
      `git origin ${JSON.stringify(reference)} needs a commit, tag, or branch name, not a path.`,
    );
  }
  const isLocal = !GIT_URL_SCHEME_PATTERN.test(repository);
  return {
    isLocal,
    kind: "git",
    ref,
    repository,
    source: isLocal ? `repository ${repository}` : `remote ${repository}`,
  };
}

const enginePlans = {
  DEFAULT_GITHUB_ASSET,
  SOURCE_VARIABLE,
  parseGitPlan,
  parseGithubPlan,
  parsePathPlan,
};

export default enginePlans;

/** @typedef {{ kind: "github", owner: string, repository: string, ref: string, asset: string, downloadUrl: string }} GithubPlan */
/** @typedef {{ kind: "path", target: string, looksLikeModule: boolean }} PathPlan */
/** @typedef {{ kind: "git", repository: string, ref: string, isLocal: boolean, source: string }} GitPlan */
