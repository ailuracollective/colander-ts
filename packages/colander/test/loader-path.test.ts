/**
 * What the bundled-asset loader promises about `COLANDER_WASM_PATH`.
 *
 * The engine ships as one packaged artifact, and one environment variable points a Node host at
 * another build instead. These tests pin that contract where the loader owns it: which file the
 * bytes came from, what a blank value means, and what an unreadable override says. The rest of
 * the boundary — envelopes, memory, traps — belongs to `binding.test.ts`.
 *
 * The workspace grants boundary-test rules to `test/binding.test.ts` by path, and that path list
 * lives in the root config this package does not own. So this file asks for the same rules by
 * name, and for nothing else: `toBe(true)` stays the strict comparison the suite asserts, and
 * every other rule here is answered in code rather than turned off.
 */
/* eslint-disable eslint/func-style, eslint/max-lines-per-function, eslint/no-magic-numbers, eslint/one-var, eslint/sort-vars, oxc/no-async-await, typescript/prefer-readonly-parameter-types, jest/prefer-to-be-falsy, jest/prefer-to-be-truthy, vitest/prefer-to-be-falsy, vitest/prefer-to-be-truthy */

import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vite-plus/test";

import { colander, loadBundledWasm } from "../src/index.ts";

vi.setConfig({ testTimeout: 5000 });

const WASM_PATH_VARIABLE = "COLANDER_WASM_PATH",
  // The unreadable case names a path that does not exist rather than creating one.
  // A failed load then cannot leave a fixture behind.
  missingEngine = path.resolve(process.cwd(), "colander-wasm-path-absent", "colander.wasm"),
  wasmUrl = new URL("../wasm/colander.wasm", import.meta.url),
  enginePath = fileURLToPath(wasmUrl);

/**
 * Views loader bytes as a Node buffer without copying them.
 *
 * The parameter stays the exact union a loader returns: `Readonly<BufferSource>` does not make
 * these bytes any less mutable, and rewriting the union to satisfy a preference rule is how a
 * byte-level comparison starts disagreeing with the bytes it was given.
 *
 * @param {BufferSource} source Bytes a loader returned.
 * @returns {Buffer} A buffer over the same memory.
 */
function asBuffer(source: BufferSource): Buffer {
  if (ArrayBuffer.isView(source)) {
    return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  }
  return Buffer.from(source);
}

/**
 * Whether two byte sources carry the same bytes.
 *
 * The packaged engine is 1.8 MB, and asking a matcher to diff one costs more than loading it did.
 *
 * @param {BufferSource} left First byte source.
 * @param {BufferSource} right Second byte source.
 * @returns {boolean} True when both sources hold identical bytes.
 */
function sameBytes(left: BufferSource, right: BufferSource): boolean {
  return Buffer.compare(asBuffer(left), asBuffer(right)) === 0;
}

/**
 * Puts the variable back the way the caller found it.
 *
 * @param {string | undefined} previous What the variable held, if anything.
 * @returns {void} Nothing.
 */
function restoreWasmPath(previous: string | undefined): void {
  if (typeof previous === "string") {
    process.env[WASM_PATH_VARIABLE] = previous;
    return;
  }
  Reflect.deleteProperty(process.env, WASM_PATH_VARIABLE);
}

/**
 * Runs `body` with `COLANDER_WASM_PATH` removed, then restores what was there.
 *
 * @param {() => Promise<void>} body Assertions to run against an absent variable.
 * @returns {Promise<void>} Resolves once the body settles.
 */
async function withoutWasmPath(body: () => Promise<void>): Promise<void> {
  const previous = process.env[WASM_PATH_VARIABLE];
  Reflect.deleteProperty(process.env, WASM_PATH_VARIABLE);
  try {
    await body();
  } finally {
    restoreWasmPath(previous);
  }
}

/**
 * Runs `body` with `COLANDER_WASM_PATH` set to `value`, then restores what was there.
 *
 * @param {string} value Value to set.
 * @param {() => Promise<void>} body Assertions to run against that value.
 * @returns {Promise<void>} Resolves once the body settles.
 */
async function withWasmPath(value: string, body: () => Promise<void>): Promise<void> {
  const previous = process.env[WASM_PATH_VARIABLE];
  process.env[WASM_PATH_VARIABLE] = value;
  try {
    await body();
  } finally {
    restoreWasmPath(previous);
  }
}

/**
 * Writes `contents` into a fresh OS temp directory as an engine-shaped file.
 *
 * @param {string} contents Bytes to write.
 * @returns {Promise<{ directory: string; file: string }>} The temporary file and its directory.
 */
async function temporaryEngineFile(contents: string): Promise<{ directory: string; file: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "colander-wasm-path-")),
    file = path.join(directory, "colander.wasm");
  await writeFile(file, contents);
  return { directory, file };
}

/**
 * Returns the rejection of `operation`.
 *
 * A resolved call is a failure of the contract under test rather than a value to assert on, so
 * this reports it as one instead of handing back something every caller has to guard against.
 *
 * @param {Promise<unknown>} operation The call under test, already started.
 * @returns {Promise<Error>} The error it rejected with.
 */
async function rejectionOf(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
  throw new Error("the call resolved, so there is no rejection to report");
}

describe("bundled WASM path override", () => {
  it("an absolute COLANDER_WASM_PATH supplies the engine", async () => {
    expect.hasAssertions();
    await withWasmPath(enginePath, async () => {
      const core = await colander.load(await loadBundledWasm({ runtime: "node" }));
      expect(core.abiVersion).toBe(1);
    });
  });

  it("reads the configured file instead of the packaged asset", async () => {
    expect.hasAssertions();
    // Pointing the override at the packaged path cannot tell honoring it from ignoring it.
    // So this case reads a file with different bytes and checks those are what came back.
    const decoy = "not the packaged engine",
      fixture = await temporaryEngineFile(decoy);
    try {
      await withWasmPath(fixture.file, async () => {
        const bytes = await loadBundledWasm({ runtime: "node" });
        expect(sameBytes(bytes, Buffer.from(decoy))).toBe(true);
        expect(sameBytes(bytes, readFileSync(enginePath))).toBe(false);
      });
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it("keeps the packaged artifact when the variable is unset or blank", async () => {
    expect.hasAssertions();
    const packaged = readFileSync(enginePath);
    await withoutWasmPath(async () => {
      expect(sameBytes(await loadBundledWasm({ runtime: "node" }), packaged)).toBe(true);
    });
    await withWasmPath("   ", async () => {
      expect(sameBytes(await loadBundledWasm({ runtime: "node" }), packaged)).toBe(true);
    });
  });

  it("resolves a relative COLANDER_WASM_PATH against the working directory", async () => {
    expect.hasAssertions();
    await withWasmPath(path.relative(process.cwd(), enginePath), async () => {
      expect(sameBytes(await loadBundledWasm({ runtime: "node" }), readFileSync(enginePath))).toBe(
        true,
      );
    });
  });

  it("names the variable and the resolved path when the override is unreadable", async () => {
    expect.hasAssertions();
    await withWasmPath("colander-wasm-path-absent/colander.wasm", async () => {
      const error = await rejectionOf(loadBundledWasm({ runtime: "node" }));
      expect(error.message).toContain(WASM_PATH_VARIABLE);
      expect(error.message).toContain(missingEngine);
    });
  });

  it("reaches colander.load() with no source and reports the bad variable", async () => {
    expect.hasAssertions();
    // `source ?? await loadBundledWasm()` puts the variable ahead of the packaged default.
    // With no source at all, the default path is the one that has to fail.
    await withWasmPath("colander-wasm-path-absent/colander.wasm", async () => {
      const error = await rejectionOf(colander.load());
      expect(error.message).toContain(WASM_PATH_VARIABLE);
    });
  });

  it("lets explicit load() bytes win over the variable", async () => {
    expect.hasAssertions();
    await withWasmPath(missingEngine, async () => {
      const core = await colander.load(readFileSync(enginePath));
      expect(core.abiVersion).toBe(1);
    });
  });

  it("leaves the browser branch on the packaged asset", async () => {
    expect.hasAssertions();
    await withWasmPath(missingEngine, async () => {
      const bytes = await loadBundledWasm({
        fetch: async () => {
          await Promise.resolve();
          return new Response(readFileSync(enginePath), { status: 200 });
        },
        runtime: "browser",
      });
      const core = await colander.load(bytes);
      expect(core.abiVersion).toBe(1);
    });
  });
});
