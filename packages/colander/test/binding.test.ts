/**
 * What the binding itself has to guarantee.
 *
 * The Rust suite already proves the core is right. These tests are about the
 * boundary: bytes that survive the trip, an envelope that becomes an exception,
 * and a heap that grows under the caller's feet.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vite-plus/test";

import { ColanderError, colander, loadBundledWasm } from "../src/index.ts";
import { instantiate, invoke, unwrap, unwrapSchema } from "../src/wasm.ts";
import type { ColanderExports } from "../src/wasm.ts";

vi.setConfig({ testTimeout: 5000 });

const wasmUrl = new URL("../wasm/colander.wasm", import.meta.url);

/**
 * Returns what `body` threw, or `undefined` when it returned normally.
 *
 * @param {() => unknown} body Operation to run.
 * @returns {unknown} The thrown value, if any.
 */
function thrownBy(body: () => unknown): unknown {
  try {
    body();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("binding boundary", () => {
  it("the module reports ABI 1 and its own identity", async () => {
    expect.hasAssertions();
    const core = await colander.load();
    expect(core.abiVersion).toBe(1);

    const info = core.versionInfo();
    expect(info.name).toBe("colander");
    expect(info.abi).toBe(1);
    expect(info.version).toBe("1.0.0");
  });

  it("supports explicit Node and browser WASM asset boundaries", async () => {
    expect.hasAssertions();
    const nodeBytes = await loadBundledWasm({ runtime: "node" });
    const nodeCore = await colander.load(nodeBytes);
    expect(nodeCore.abiVersion).toBe(1);

    const browserBytes = await loadBundledWasm({
      fetch: async () => {
        await Promise.resolve();
        return new Response(nodeBytes, { status: 200 });
      },
      runtime: "browser",
    });

    const browserCore = await colander.load(browserBytes);
    expect(browserCore.abiVersion).toBe(1);
  });

  it("fails explicitly when the browser WASM asset is unavailable", async () => {
    expect.hasAssertions();
    await expect(
      loadBundledWasm({
        fetch: async () => {
          await Promise.resolve();
          return new Response("", { status: 404, statusText: "missing" });
        },
        runtime: "browser",
      }),
    ).rejects.toThrow(/could not load .*wasm\/colander\.wasm: 404 missing/u);
  });

  it("the public loader is lowercase and no class is exported", async () => {
    expect.hasAssertions();
    const publicApi = await import("../src/index.ts");
    expect(publicApi.colander).toBe(colander);
    expect(Object.keys(publicApi)).not.toContain("Colander");
  });

  it("a rejected payload throws a typed error", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      error = thrownBy(() => core.compile({ formSchemaJson: "not json" }));
    expect(error).toBeInstanceOf(ColanderError);
    expect((error as ColanderError).kind).toBe("validation");
  });

  it("validateSchema answers instead of throwing", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      schemaJson = JSON.stringify({ required: ["id"], type: "object" }),
      missing = core.validateSchema({
        instanceJson: JSON.stringify({}),
        kind: "instance",
        label: "thing",
        schemaJson,
      });
    expect(missing).toHaveProperty("valid", false);
    expect(missing).toHaveProperty("message", expect.stringContaining("Invalid thing:"));

    const present = core.validateSchema({
      instanceJson: JSON.stringify({ id: 1 }),
      kind: "instance",
      label: "thing",
      schemaJson,
    });
    expect(present).toStrictEqual({ valid: true });
  });

  it("keeps typed schema failures as errors", () => {
    expect.hasAssertions();
    expect(
      unwrapSchema({ error: { kind: "validation", message: "invalid" }, ok: false }),
    ).toStrictEqual({
      code: "",
      message: "invalid",
      valid: false,
    });
    expect(
      unwrapSchema({
        error: { kind: "validation", message: "RULE_UNKNOWN_CODE: 'x' is not a field." },
        ok: false,
      }),
    ).toStrictEqual({
      code: "RULE_UNKNOWN_CODE",
      message: "RULE_UNKNOWN_CODE: 'x' is not a field.",
      valid: false,
    });
    expect(() =>
      unwrapSchema({ error: { kind: "invalid_request", message: "invalid request" }, ok: false }),
    ).toThrow(ColanderError);
    expect(() => unwrapSchema({ error: { kind: "panic", message: "panic" }, ok: false })).toThrow(
      ColanderError,
    );
  });

  it("string escaping survives the boundary byte for byte", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      // Every character here is one the canonical writer escapes: a quote becomes
      // \u0022 rather than \", and non-ASCII becomes \uXXXX rather than UTF-8.
      label = 'quote " accent é emoji 😀',
      compiled = core.compile({
        formSchemaJson: JSON.stringify({
          fields: [{ code: "a", id: "a", label, type: "text" }],
          schemaVersion: "1.0.0",
        }),
      });

    expect(compiled.formSchemaJson).toContain(String.raw`\u0022`);
    expect(compiled.formSchemaJson).toContain(String.raw`\u00E9`);
    expect(compiled.formSchemaJson).toContain(String.raw`\uD83D\uDE00`);
    expect(compiled.formSchemaJson).not.toContain(label);
  });

  it("a UTF-8 request is not mangled on the way in", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      // The request itself carries multi-byte text, so a byte-length mistake in the
      // Buffer would truncate it or corrupt the envelope.
      label = "ñ".repeat(500) + "😀".repeat(100),
      first = core.contentHash({ formSchemaJson: JSON.stringify({ label }) }),
      second = core.contentHash({ formSchemaJson: JSON.stringify({ label }) });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("calls survive the heap growing underneath them", async () => {
    expect.hasAssertions();
    const core = await colander.load();
    // A view cached before a call is detached once memory grows; a binding that
    // Cached one would read zeros here rather than fail loudly.
    for (let step = 0; step < 64; step += 1) {
      const label = "x".repeat(step * 8192),
        hash = core.contentHash({ formSchemaJson: JSON.stringify({ label }) });
      expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("the request and response buffers are always released", async () => {
    expect.hasAssertions();
    const wasm = await instantiate(readFileSync(wasmUrl)),
      ok = { formSchemaJson: JSON.stringify({ fields: [] }) },
      bad = { formSchemaJson: "not json" };

    // Warm up, so the heap has reached the size it settles at.
    for (let i = 0; i < 500; i += 1) {
      invoke(wasm, wasm.colander_content_hash, ok);
    }
    const settled = wasm.memory.buffer.byteLength;

    // Both paths allocate the input, and the failure path also builds an
    // Envelope to hand back. Either leak shows up as growth.
    for (let i = 0; i < 5000; i += 1) {
      invoke(wasm, wasm.colander_content_hash, ok);
      invoke(wasm, wasm.colander_content_hash, bad);
    }

    expect(
      wasm.memory.buffer.byteLength,
      "the heap grew across identical calls, so a buffer is not being freed",
    ).toBe(settled);
  });

  it("a stale module is rejected with a readable message", async () => {
    expect.hasAssertions();
    // An empty module has none of the exports the binding drives.
    const empty = new WebAssembly.Module(
      new Uint8Array([0x00, 0x61, 0x73, 109, 0x01, 0x00, 0x00, 0x00]),
    );
    await expect(instantiate(empty)).rejects.toThrow(/does not export colander_compile/u);
  });

  it("a caught Rust panic remains a normal error envelope", () => {
    expect.hasAssertions();
    const error = thrownBy(() =>
      unwrap({
        error: { kind: "panic", message: "colander panicked: boom" },
        ok: false,
      }),
    ) as ColanderError;

    expect(error).toBeInstanceOf(ColanderError);
    expect(error.kind).toBe("panic");
    expect(error.message).toBe("colander panicked: boom");
  });

  /**
   * A guest that exposes only the allocator surface needed by `invoke`.
   *
   * @returns {object} The trapping guest and its allocation log.
   */
  function trappingGuest(): { freed: number[]; trap: () => number; wasm: ColanderExports } {
    const memory = new WebAssembly.Memory({ initial: 1 }),
      freed: number[] = [],
      wasm = {
        colander_alloc: () => 1024,
        colander_free_buffer: (pointer: number) => void freed.push(pointer),
        colander_free_string: (): void => undefined,
        memory,
      } as unknown as ColanderExports,
      trap = (): number => {
        throw new WebAssembly.RuntimeError("unreachable");
      };
    return { freed, trap, wasm };
  }

  it("a WebAssembly trap reports its text and retires the instance", () => {
    expect.hasAssertions();
    const { wasm, trap, freed } = trappingGuest(),
      first = thrownBy(() => invoke(wasm, trap, {})) as ColanderError;
    expect(first).toBeInstanceOf(ColanderError);
    expect(first.kind).toBe("panic");
    expect(first.message).toContain("WebAssembly trap: unreachable");
    expect(first.message).toContain("colander.load()");

    // Do not call back into guest state whose trap already made it uncertain.
    expect(freed).toStrictEqual([]);

    const second = thrownBy(() => invoke(wasm, trap, {})) as ColanderError;
    expect(second).toBeInstanceOf(ColanderError);
    expect(second.kind).toBe("panic");
    expect(second.message).toContain("colander.load()");
    expect(freed).toStrictEqual([]);
  });
});
