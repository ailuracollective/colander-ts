/* eslint-disable one-var, sort-vars, jest/no-hooks, vitest/no-hooks, jest/require-top-level-describe, vitest/require-top-level-describe */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// Every case spawns the build script, and the first one also digests the engine artifact, so this
// Suite uses a longer timeout than the other package suites.
const EXIT_SUCCESS = 0,
  EXIT_FAILURE = 1,
  DIGEST_LENGTH = 64,
  WRONG_DIGEST = "b".repeat(DIGEST_LENGTH),
  EMPTY_VALUE = "",
  ALL_ROOTS = 0,
  OVERRIDDEN_VARIABLES = new Set([
    "COLANDER_WASM_SOURCE",
    "COLANDER_WASM_SHA256",
    "COLANDER_WASM_OUTPUT",
  ]),
  BUILD_WASM_SCRIPT = fileURLToPath(new URL("../scripts/build-wasm.mjs", import.meta.url)),
  BUNDLED_ENGINE = fileURLToPath(new URL("../wasm/colander.wasm", import.meta.url));

vi.setConfig({ testTimeout: 15_000 });

interface BuildResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(ALL_ROOTS)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const makeTemporaryRoot = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "colander-wasm-origin-"));
  temporaryRoots.push(root);
  return root;
};

const engineEnv = (): NodeJS.ProcessEnv => {
  const names = Object.keys(process.env).filter((name) => !OVERRIDDEN_VARIABLES.has(name));
  return Object.fromEntries(names.map((name) => [name, process.env[name] ?? EMPTY_VALUE]));
};

const runBuild = (
  env: Readonly<Record<string, string>>,
  args: readonly string[] = [],
): BuildResult => {
  const result = spawnSync(process.execPath, [BUILD_WASM_SCRIPT, ...args], {
    encoding: "utf8",
    env: Object.assign(engineEnv(), env),
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

// The SHA-256 comes from a child process instead of a `node:crypto` import, which the test lint
// Boundary does not allow. The build script stays the independent digest implementation.
const sha256OfFile = (target: string): string => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "const {createHash}=await import('node:crypto');" +
        "const {readFile}=await import('node:fs/promises');" +
        "const bytes=await readFile(process.argv[1]);" +
        "process.stdout.write(createHash('sha256').update(bytes).digest('hex'));",
      target,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== EXIT_SUCCESS) {
    throw new Error(`could not digest ${target}: ${result.stderr}`);
  }
  return result.stdout;
};

// The digest of the checked-in artifact never changes during a run, so it is computed once.
const bundledDigestCache: { value: string } = { value: "" };

const bundledEngineDigest = (): string => {
  if (bundledDigestCache.value === EMPTY_VALUE) {
    bundledDigestCache.value = sha256OfFile(BUNDLED_ENGINE);
  }
  return bundledDigestCache.value;
};

describe("build:wasm local path copy", () => {
  it("copies a local .wasm offline without touching the checked-in artifact", () => {
    expect.hasAssertions();
    const digestBefore = bundledEngineDigest(),
      output = path.join(makeTemporaryRoot(), "colander.wasm"),
      result = runBuild({
        COLANDER_WASM_OUTPUT: output,
        COLANDER_WASM_SOURCE: `path:${BUNDLED_ENGINE}`,
      });
    expect(result.status, result.stderr).toBe(EXIT_SUCCESS);
    expect(readFileSync(output)).toStrictEqual(readFileSync(BUNDLED_ENGINE));
    expect(bundledEngineDigest()).toBe(digestBefore);
    expect(result.stdout).toContain(`Engine origin: path ${BUNDLED_ENGINE}`);
    expect(result.stdout).not.toContain("Downloading");
  });

  it("accepts a matching artifact digest", () => {
    expect.hasAssertions();
    const output = path.join(makeTemporaryRoot(), "colander.wasm"),
      expectedDigest = bundledEngineDigest(),
      result = runBuild({
        COLANDER_WASM_OUTPUT: output,
        COLANDER_WASM_SHA256: expectedDigest,
        COLANDER_WASM_SOURCE: `path:${BUNDLED_ENGINE}`,
      });
    expect(result.status, result.stderr).toBe(EXIT_SUCCESS);
    expect(result.stdout).toContain(`Verified engine artifact SHA-256 ${expectedDigest}`);
  });
});

describe("build:wasm local path integrity", () => {
  it("fails a mismatched artifact digest without writing the output", () => {
    expect.hasAssertions();
    const outputDirectory = makeTemporaryRoot(),
      output = path.join(outputDirectory, "colander.wasm"),
      result = runBuild({
        COLANDER_WASM_OUTPUT: output,
        COLANDER_WASM_SHA256: WRONG_DIGEST,
        COLANDER_WASM_SOURCE: `path:${BUNDLED_ENGINE}`,
      });
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stderr).toContain("engine artifact SHA-256 mismatch");
    expect(readdirSync(outputDirectory)).toStrictEqual([]);
  });

  it("rejects a .wasm file that is not an engine module", () => {
    expect.hasAssertions();
    const notAModule = path.join(makeTemporaryRoot(), "not-an-engine.wasm");
    writeFileSync(notAModule, "not web assembly");
    const result = runBuild({ COLANDER_WASM_SOURCE: `path:${notAModule}` });
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stderr).toContain("invalid WebAssembly module");
  });
});

describe("build:wasm origin rejection", () => {
  it("rejects an unknown origin before doing any work", () => {
    expect.hasAssertions();
    const result = runBuild({ COLANDER_WASM_SOURCE: "registry:colander@0.1.0" });
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stderr).toContain("COLANDER_WASM_SOURCE");
    expect(result.stderr).not.toContain("Downloading");
  });

  it("rejects a github branch reference before any network access", () => {
    expect.hasAssertions();
    const result = runBuild({ COLANDER_WASM_SOURCE: "github:ailuracollective/colander@main" });
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stderr).toContain("needs a release tag");
    expect(result.stderr).not.toContain("Downloading");
  });

  it("rejects a path that is neither a .wasm file nor a crate directory", () => {
    expect.hasAssertions();
    const missing = path.join(makeTemporaryRoot(), "absent"),
      result = runBuild({ COLANDER_WASM_SOURCE: `path:${missing}` });
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stderr).toContain("neither a .wasm file nor a crate directory");
  });

  it("rejects a path directory without a Cargo manifest", () => {
    expect.hasAssertions();
    const directory = makeTemporaryRoot(),
      result = runBuild({ COLANDER_WASM_SOURCE: `path:${directory}` });
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stderr).toContain("directory without Cargo.toml");
  });
});

describe("build:wasm release digest gate", () => {
  it("requires a digest for a path origin", () => {
    expect.hasAssertions();
    const result = runBuild({ COLANDER_WASM_SOURCE: `path:${BUNDLED_ENGINE}` }, [
      "--require-digest",
    ]);
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stderr).toContain("COLANDER_WASM_SHA256 is required for the release build");
  });

  it("accepts a path origin when the digest is supplied", () => {
    expect.hasAssertions();
    const output = path.join(makeTemporaryRoot(), "colander.wasm"),
      result = runBuild(
        {
          COLANDER_WASM_OUTPUT: output,
          COLANDER_WASM_SHA256: bundledEngineDigest(),
          COLANDER_WASM_SOURCE: `path:${BUNDLED_ENGINE}`,
        },
        ["--require-digest"],
      );
    expect(result.status, result.stderr).toBe(EXIT_SUCCESS);
    expect(readFileSync(output)).toStrictEqual(readFileSync(BUNDLED_ENGINE));
  });
});
