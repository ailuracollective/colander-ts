import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The shared preflight module is intentionally self-contained and keeps all corpus rules together.
/* eslint-disable max-lines, import/no-default-export */

const REQUIRED_VECTOR_FILES = [
  "hash.json",
  "semver.json",
  "validate.json",
  "compile.json",
  "rules.json",
];

/** @type {ReplayGroup[]} */
const REPLAY_GROUPS = ["hash", "semver", "validate", "validateErrors", "compile", "rules"];

/** @type {Record<ReplayGroup, string>} */
const REPLAY_SOURCE_FILES = {
  compile: "compile.json",
  hash: "hash.json",
  rules: "rules.json",
  semver: "semver.json",
  validate: "validate.json",
  validateErrors: "validate.json",
};

const DEFAULT_CONTRACT_CORPUS_DIRECTORY = fileURLToPath(
  new URL("../test/fixtures/contract-vectors/colander-0.1.0/", import.meta.url),
);
const DEFAULT_CONTRACT_CORPUS_LOCK_PATH = fileURLToPath(
  new URL("../test/fixtures/contract-vectors/colander-0.1.0/corpus.lock.json", import.meta.url),
);

/**
 * @typedef {{ name: string, version: string, abi: number }} CoreIdentity
 * @typedef {{ repositoryLabel: string, commit: string, describe: string }} CorpusSource
 * @typedef {{ sha256: string, records: number }} CorpusFile
 * @typedef {{ name: string, reason: string }} CorpusExclusion
 * @typedef {{ [key: string]: CorpusFile }} CorpusFiles
 * @typedef {{ hash: CorpusExclusion[], semver: CorpusExclusion[], validate: CorpusExclusion[], validateErrors: CorpusExclusion[], compile: CorpusExclusion[], rules: CorpusExclusion[] }} ReplayExclusions
 * @typedef {{ hash: number, semver: number, validate: number, validateErrors: number, compile: number, rules: number }} ReplayInventory
 * @typedef {"hash" | "semver" | "validate" | "validateErrors" | "compile" | "rules"} ReplayGroup
 * @typedef {{ hash: unknown[], semver: unknown[], validate: unknown[], validateErrors: unknown[], compile: unknown[], rules: unknown[] }} ReplayEntries
 * @typedef {{ core: CoreIdentity, source: CorpusSource, files: CorpusFiles, replayExclusions: ReplayExclusions, replayInventory: ReplayInventory }} CorpusLock
 * @typedef {{ directory: string, lockPath: string }} CorpusLocation
 * @typedef {{ directory: string, lock: CorpusLock, entries: Record<string, unknown[]>, replay: ReplayEntries, inventory: ReplayInventory }} ValidatedCorpus
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is CorpusLock}
 */
function isCorpusLock(value) {
  return (
    isRecord(value) &&
    isRecord(value.core) &&
    isRecord(value.source) &&
    isRecord(value.files) &&
    isRecord(value.replayExclusions) &&
    isRecord(value.replayInventory)
  );
}

/**
 * @param {string} message
 * @returns {never}
 */
function preflightError(message) {
  throw new Error(`Contract corpus preflight failed: ${message}`);
}

/**
 * @param {string} lockPath
 * @returns {unknown}
 */
function parseLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Contract corpus preflight failed: cannot read lock file ${lockPath} (${reason})`,
      {
        cause: error,
      },
    );
  }
}

/**
 * @param {string} lockPath
 * @returns {CorpusLock}
 */
function readLock(lockPath) {
  if (!existsSync(lockPath)) {
    preflightError(`lock file is missing: ${lockPath}`);
  }

  const parsed = parseLock(lockPath);
  if (!isCorpusLock(parsed)) {
    preflightError(`lock file has an invalid shape: ${lockPath}`);
  }
  return parsed;
}

/**
 * @param {CorpusLock} lock
 * @param {string} lockPath
 * @returns {void}
 */
function validateLock(lock, lockPath) {
  const { core, source, files, replayExclusions, replayInventory } = lock;
  if (
    typeof core.name !== "string" ||
    typeof core.version !== "string" ||
    typeof core.abi !== "number" ||
    typeof source.repositoryLabel !== "string" ||
    typeof source.commit !== "string" ||
    typeof source.describe !== "string"
  ) {
    preflightError(`lock file is missing core/source identity fields: ${lockPath}`);
  }

  for (const fileName of REQUIRED_VECTOR_FILES) {
    const entry = files[fileName];
    if (!isRecord(entry) || typeof entry.sha256 !== "string" || typeof entry.records !== "number") {
      preflightError(`lock file has no valid metadata for ${fileName}: ${lockPath}`);
    }
  }
  for (const group of REPLAY_GROUPS) {
    if (typeof replayInventory[group] !== "number") {
      preflightError(`lock file has no replay inventory for ${group}: ${lockPath}`);
    }
    const exclusions = replayExclusions[group];
    if (!Array.isArray(exclusions)) {
      preflightError(`lock file has no replay exclusions for ${group}: ${lockPath}`);
    }
    for (const exclusion of exclusions) {
      if (
        !isRecord(exclusion) ||
        typeof exclusion.name !== "string" ||
        typeof exclusion.reason !== "string"
      ) {
        preflightError(`lock file has an invalid replay exclusion for ${group}: ${lockPath}`);
      }
    }
  }
}

/** @returns {CorpusLocation} */
function resolveConfiguredLocation() {
  const configured = process.env.COLANDER_VECTORS;
  if (typeof configured !== "string" || configured.length === 0) {
    return {
      directory: DEFAULT_CONTRACT_CORPUS_DIRECTORY,
      lockPath: DEFAULT_CONTRACT_CORPUS_LOCK_PATH,
    };
  }

  const base = resolve(configured);
  return {
    directory: base,
    lockPath: join(base, "corpus.lock.json"),
  };
}

/**
 * @param {string} directory
 * @param {string} fileName
 * @param {CorpusFile} expected
 * @returns {unknown[]}
 */
function readVectorFile(directory, fileName, expected) {
  const path = join(directory, fileName);
  if (!existsSync(path)) {
    preflightError(`required file is missing: ${path}`);
  }

  const bytes = (() => {
    try {
      const fileStats = statSync(path);
      if (!fileStats.isFile() || fileStats.size === 0) {
        preflightError(`required file is empty: ${path}`);
      }
      return readFileSync(path);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Contract corpus preflight failed: cannot read ${path} (${reason})`, {
        cause: error,
      });
    }
  })();

  const entries = (() => {
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Contract corpus preflight failed: ${fileName} is not valid JSON (${reason})`,
        { cause: error },
      );
    }
  })();
  if (!Array.isArray(entries)) {
    preflightError(`${fileName} must contain an array`);
  }
  if (entries.length !== expected.records) {
    preflightError(
      `record count mismatch for ${fileName}: expected ${expected.records}, found ${entries.length}`,
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expected.sha256) {
    preflightError(
      `SHA-256 mismatch for ${fileName}: expected ${expected.sha256}, found ${digest}`,
    );
  }
  return entries;
}

/**
 * @param {unknown} entry
 * @returns {entry is Record<string, unknown>}
 */
function isExpectedEntry(entry) {
  return isRecord(entry) && entry.expected !== null && Object.hasOwn(entry, "expected");
}

/**
 * @param {unknown} entry
 * @returns {entry is Record<string, unknown>}
 */
function isRuleEntryReachable(entry) {
  if (!isExpectedEntry(entry) || typeof entry.name !== "string") {
    return false;
  }
  return !entry.name.startsWith("analyze:") && !entry.name.startsWith("validateDependencies:");
}

/**
 * @param {Record<string, unknown[]>} entries
 * @param {string} fileName
 * @returns {unknown[]}
 */
function entriesFor(entries, fileName) {
  const group = entries[fileName];
  if (!group) {
    preflightError(`internal corpus map is missing ${fileName}`);
  }
  return group;
}

/**
 * @param {Record<string, unknown[]>} entries
 * @param {ReplayExclusions} exclusions
 * @returns {void}
 */
function validateExclusions(entries, exclusions) {
  for (const group of REPLAY_GROUPS) {
    const source = entriesFor(entries, REPLAY_SOURCE_FILES[group]);
    for (const exclusion of exclusions[group]) {
      if (!source.some((entry) => isRecord(entry) && entry.name === exclusion.name)) {
        preflightError(
          `replay exclusion ${exclusion.name} is not present in ${REPLAY_SOURCE_FILES[group]}`,
        );
      }
    }
  }
}

/**
 * @param {unknown} entry
 * @param {CorpusExclusion[]} exclusions
 * @returns {boolean}
 */
function isExcluded(entry, exclusions) {
  return (
    isRecord(entry) &&
    typeof entry.name === "string" &&
    exclusions.some((exclusion) => exclusion.name === entry.name)
  );
}

/**
 * @param {Record<string, unknown[]>} entries
 * @param {ReplayExclusions} exclusions
 * @returns {ReplayEntries}
 */
function deriveReplay(entries, exclusions) {
  return {
    compile: entriesFor(entries, "compile.json").filter(
      (entry) => isExpectedEntry(entry) && !isExcluded(entry, exclusions.compile),
    ),
    hash: entriesFor(entries, "hash.json").filter(
      (entry) =>
        isRecord(entry) && typeof entry.hash === "string" && !isExcluded(entry, exclusions.hash),
    ),
    rules: entriesFor(entries, "rules.json").filter(
      (entry) => isRuleEntryReachable(entry) && !isExcluded(entry, exclusions.rules),
    ),
    semver: entriesFor(entries, "semver.json").filter(
      (entry) =>
        isRecord(entry) && typeof entry.next === "string" && !isExcluded(entry, exclusions.semver),
    ),
    validate: entriesFor(entries, "validate.json").filter(
      (entry) => isExpectedEntry(entry) && !isExcluded(entry, exclusions.validate),
    ),
    validateErrors: entriesFor(entries, "validate.json").filter(
      (entry) =>
        isRecord(entry) &&
        typeof entry.error === "string" &&
        entry.error.length > 0 &&
        !isExcluded(entry, exclusions.validateErrors),
    ),
  };
}

/**
 * Validate a locked corpus and return its parsed replay groups.
 *
 * The default location is the checked-in corpus. COLANDER_VECTORS is an
 * explicit opt-in directory only; its lock file must be adjacent, and no
 * sibling or parent lock file is searched.
 *
 * @param {CorpusLocation} [location]
 * @returns {ValidatedCorpus}
 */
function validateContractCorpus(location = resolveConfiguredLocation()) {
  const lock = readLock(location.lockPath);
  validateLock(lock, location.lockPath);

  /** @type {Record<string, unknown[]>} */
  const entries = {};
  for (const fileName of REQUIRED_VECTOR_FILES) {
    const metadata = lock.files[fileName];
    if (!metadata) {
      preflightError(`lock file has no metadata for ${fileName}: ${location.lockPath}`);
    }
    entries[fileName] = readVectorFile(location.directory, fileName, metadata);
  }

  validateExclusions(entries, lock.replayExclusions);
  const replay = deriveReplay(entries, lock.replayExclusions);
  for (const group of REPLAY_GROUPS) {
    const expected = lock.replayInventory[group];
    const actual = replay[group].length;
    if (actual !== expected) {
      preflightError(
        `replay inventory mismatch for ${group}: expected ${expected}, found ${actual} in ${location.directory}`,
      );
    }
  }

  return {
    directory: location.directory,
    entries,
    inventory: lock.replayInventory,
    lock,
    replay,
  };
}

const contractCorpus = {
  DEFAULT_CONTRACT_CORPUS_DIRECTORY,
  DEFAULT_CONTRACT_CORPUS_LOCK_PATH,
  REPLAY_GROUPS,
  REQUIRED_VECTOR_FILES,
  validateContractCorpus,
};

export default contractCorpus;
