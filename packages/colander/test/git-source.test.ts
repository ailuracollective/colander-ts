/* eslint-disable one-var, sort-vars, jest/no-hooks, vitest/no-hooks, jest/require-top-level-describe, vitest/require-top-level-describe, oxc/no-async-await */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import gitSource from "../scripts/git-source.mjs";

vi.setConfig({ testTimeout: 15_000 });

const { materializeGitSource } = gitSource;

const ALL_ROOTS = 0,
  FIRST_REVISION = "first",
  SECOND_REVISION = "second",
  V1_TAG = "v1.0.0",
  FIRST_BODY = "// first\n",
  SECOND_BODY = "// second\n",
  MANIFEST_BODY = '[package]\nname = "fixture"\nversion = "0.0.0"\n',
  GIT_IDENTITY = [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "init.defaultBranch=main",
  ],
  SHA_LENGTH = 40;

interface MaterializedSource {
  readonly commit: string;
  readonly directory: string;
}

interface Fixture {
  readonly firstCommit: string;
  readonly headCommit: string;
  readonly root: string;
}

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(ALL_ROOTS)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const makeTemporaryRoot = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "colander-git-source-"));
  temporaryRoots.push(root);
  return root;
};

const git = (arguments_: readonly string[], cwd: string): string =>
  execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const commitAll = (root: string, message: string): void => {
  git(["add", "."], root);
  git(["commit", "--quiet", "-m", message], root);
};

const writeCrate = (source: string, body: string): void => {
  writeFileSync(path.join(source, "Cargo.toml"), MANIFEST_BODY);
  writeFileSync(path.join(source, "lib.rs"), body);
};

/**
 * Builds a throwaway repository whose first commit is a crate root and whose second commit changes
 * it, so a materialization can be pinned to either revision.
 *
 * @returns {Fixture} the fixture repository and its resolved commits
 */
const makeFixtureRepository = (): Fixture => {
  const root = makeTemporaryRoot(),
    source = path.join(root, "crate");
  mkdirSync(source);
  git([...GIT_IDENTITY, "init", "--quiet"], root);
  writeCrate(source, FIRST_BODY);
  commitAll(root, FIRST_REVISION);
  git(["tag", V1_TAG], root);
  const firstCommit = git(["rev-parse", "HEAD"], root);
  writeCrate(source, SECOND_BODY);
  commitAll(root, SECOND_REVISION);
  return { firstCommit, headCommit: git(["rev-parse", "HEAD"], root), root };
};

const materialize = async (fixture: Fixture, ref: string): Promise<MaterializedSource> => {
  const source = await materializeGitSource({
    destination: makeTemporaryRoot(),
    isLocal: true,
    ref,
    repository: fixture.root,
  });
  return source;
};

const readBody = (directory: string): string =>
  readFileSync(path.join(directory, "lib.rs"), "utf8");

describe("git engine source materialization", () => {
  it("materializes a local repository by full commit", async () => {
    expect.hasAssertions();
    const fixture = makeFixtureRepository(),
      source = await materialize(fixture, fixture.firstCommit);
    expect(source.commit).toBe(fixture.firstCommit);
    expect(readBody(source.directory)).toBe(FIRST_BODY);
    expect(readFileSync(path.join(source.directory, "Cargo.toml"), "utf8")).toContain(
      'name = "fixture"',
    );
  });

  it("leaves the source repository untouched", async () => {
    expect.hasAssertions();
    const fixture = makeFixtureRepository(),
      headBefore = git(["rev-parse", "HEAD"], fixture.root),
      statusBefore = git(["status", "--porcelain"], fixture.root);
    await materialize(fixture, fixture.firstCommit);
    expect(git(["rev-parse", "HEAD"], fixture.root)).toBe(headBefore);
    expect(git(["status", "--porcelain"], fixture.root)).toBe(statusBefore);
  });

  it("materializes a local repository by tag", async () => {
    expect.hasAssertions();
    const fixture = makeFixtureRepository(),
      source = await materialize(fixture, V1_TAG);
    expect(source.commit).toBe(fixture.firstCommit);
    expect(readBody(source.directory)).toBe(FIRST_BODY);
  });

  it("materializes a local branch tip", async () => {
    expect.hasAssertions();
    const fixture = makeFixtureRepository(),
      source = await materialize(fixture, "main");
    expect(source.commit).toBe(fixture.headCommit);
    expect(readBody(source.directory)).toBe(SECOND_BODY);
  });
});

describe("git engine source rejection", () => {
  it("rejects a commit that does not exist in the repository", async () => {
    expect.hasAssertions();
    const fixture = makeFixtureRepository();
    const missingCommit = "0".repeat(SHA_LENGTH);
    await expect(materialize(fixture, missingCommit)).rejects.toThrow(/failed/u);
  });

  it("rejects a repository that is not a crate at its root", async () => {
    expect.hasAssertions();
    const fixture = makeFixtureRepository();
    writeFileSync(path.join(fixture.root, "README.md"), "monorepo\n");
    commitAll(fixture.root, "monorepo root");
    await expect(materialize(fixture, "main")).rejects.toThrow(/has no Cargo.toml at its root/u);
  });
});
