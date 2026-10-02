import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import contractCorpus from "../scripts/contract-corpus.mjs";
import { colander } from "../src/index.ts";

/* eslint-disable jest/no-hooks, vitest/no-hooks */
const {
  DEFAULT_CONTRACT_CORPUS_DIRECTORY,
  DEFAULT_CONTRACT_CORPUS_LOCK_PATH,
  REPLAY_GROUPS,
  REQUIRED_VECTOR_FILES,
  validateContractCorpus,
} = contractCorpus;

interface LockedCore {
  readonly name: string;
  readonly version: string;
  readonly abi: number;
}

vi.setConfig({ testTimeout: 5000 });

const temporaryRoots: string[] = [];

interface CorpusCopy {
  root: string;
  directory: string;
  lockPath: string;
}

function copyLockedCorpus(): CorpusCopy {
  const root = mkdtempSync(join(tmpdir(), "colander-contract-corpus-"));
  const directory = join(root, "colander-0.1.0");
  mkdirSync(directory);
  for (const fileName of REQUIRED_VECTOR_FILES) {
    cpSync(join(DEFAULT_CONTRACT_CORPUS_DIRECTORY, fileName), join(directory, fileName));
  }
  const lockPath = join(root, "corpus.lock.json");
  cpSync(DEFAULT_CONTRACT_CORPUS_LOCK_PATH, lockPath);
  temporaryRoots.push(root);
  return { directory, lockPath, root };
}

function validateCopy(copy: CorpusCopy): ReturnType<typeof validateContractCorpus> {
  return validateContractCorpus({ directory: copy.directory, lockPath: copy.lockPath });
}

function updateLock(copy: CorpusCopy, update: (lock: Record<string, unknown>) => void): void {
  const lock = JSON.parse(readFileSync(copy.lockPath, "utf8")) as Record<string, unknown>;
  update(lock);
  writeFileSync(copy.lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

describe("locked contract corpus preflight", () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("accepts the exact checked-in corpus", () => {
    expect.hasAssertions();
    const corpus = validateContractCorpus({
      directory: DEFAULT_CONTRACT_CORPUS_DIRECTORY,
      lockPath: DEFAULT_CONTRACT_CORPUS_LOCK_PATH,
    });

    expect(corpus.directory).toBe(DEFAULT_CONTRACT_CORPUS_DIRECTORY);
    for (const group of REPLAY_GROUPS) {
      expect(corpus.replay[group]).toHaveLength(corpus.inventory[group]);
    }
  });

  it("rejects a missing required file", () => {
    expect.hasAssertions();
    const copy = copyLockedCorpus();
    rmSync(join(copy.directory, "rules.json"));

    expect(() => validateCopy(copy)).toThrow(/required file is missing: .*rules\.json/u);
  });

  it("rejects malformed JSON", () => {
    expect.hasAssertions();
    const copy = copyLockedCorpus();
    writeFileSync(join(copy.directory, "semver.json"), "{]");

    expect(() => validateCopy(copy)).toThrow(/semver\.json is not valid JSON/u);
  });

  it("rejects a non-array group", () => {
    expect.hasAssertions();
    const copy = copyLockedCorpus();
    writeFileSync(join(copy.directory, "compile.json"), "{}");

    expect(() => validateCopy(copy)).toThrow(/compile\.json must contain an array/u);
  });

  it("rejects a digest mismatch", () => {
    expect.hasAssertions();
    const copy = copyLockedCorpus();
    appendFileSync(join(copy.directory, "hash.json"), "\n");

    expect(() => validateCopy(copy)).toThrow(/SHA-256 mismatch for hash\.json/u);
  });

  it("rejects a replay inventory mismatch", () => {
    expect.hasAssertions();
    const copy = copyLockedCorpus();
    updateLock(copy, (lock) => {
      const inventory = lock.replayInventory as Record<string, number>;
      inventory.validate = 59;
    });

    expect(() => validateCopy(copy)).toThrow(
      /replay inventory mismatch for validate: expected 59/u,
    );
  });

  it("rejects a stale replay exclusion", () => {
    expect.hasAssertions();
    const copy = copyLockedCorpus();
    updateLock(copy, (lock) => {
      const exclusions = lock.replayExclusions as Record<string, Record<string, unknown>[]>;
      exclusions.validate?.push({ name: "not-in-corpus", reason: "test fixture" });
    });

    expect(() => validateCopy(copy)).toThrow(
      /replay exclusion not-in-corpus is not present in validate\.json/u,
    );
  });

  it("pins the vendored binary to the core the lock declares", async () => {
    /**
     * The lock used to name a core the vendored binary did not report, and
     * nothing compared the two: a repinned binary stayed invisible until a
     * behaviour test failed somewhere else entirely. This is the assertion
     * that makes a repin loud.
     */
    expect.hasAssertions();
    const lock = JSON.parse(readFileSync(DEFAULT_CONTRACT_CORPUS_LOCK_PATH, "utf8")) as {
      core: LockedCore;
    };
    const core = await colander.load();
    const info = core.versionInfo();

    expect(info.name).toBe(lock.core.name);
    expect(info.abi).toBe(lock.core.abi);
    expect(info.version).toBe(lock.core.version);
  });
});
