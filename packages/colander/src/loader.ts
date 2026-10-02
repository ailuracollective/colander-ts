/**
 * Where the engine bytes come from.
 *
 * The package ships one artifact, `wasm/colander.wasm`, and a host reads it in
 * whichever way its runtime allows: from disk under Node, over `fetch` under a
 * browser or a Worker. The branch lives here, behind one function, so a bundler
 * can externalize the Node built-in without changing the browser behavior, and
 * so a test can pin the boundary with an explicit runtime.
 *
 * Under Node one environment variable, `COLANDER_WASM_PATH`, replaces the packaged
 * path. It exists because a deployment may hold a rebuilt engine somewhere the
 * packaged asset cannot reach — a container image, a mounted volume, a linked
 * checkout. Precedence is explicit `colander.load(source)` bytes, then that
 * variable, then the packaged default; the browser branch has no filesystem to
 * read and ignores the variable entirely rather than pretend to honor it.
 */

/** Which side of the asset boundary the host is on. */
export type WasmRuntime = "node" | "browser";

/** Overrides for `loadBundledWasm`, for a host or a deterministic boundary test. */
export interface WasmAssetLoaderOptions {
  /** Override runtime detection. */
  readonly runtime?: WasmRuntime;
  /** Inject the browser/Worker fetch implementation when needed. */
  readonly fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

declare const process:
  | {
      cwd: () => string;
      env?: Record<string, string | undefined>;
      versions: Record<string, string>;
      release?: { name?: string };
    }
  | undefined;

const WASM_PATH_VARIABLE = "COLANDER_WASM_PATH";

// This neutral source's lint environment declares none of the runtime globals this file uses.
// Each is reached below through `globalThis`: the same objects, under the name every runtime uses.
const bundledWasmUrl = new globalThis.URL("../wasm/colander.wasm", import.meta.url);

const detectWasmRuntime = (): WasmRuntime => {
  if (typeof process === "object" && "release" in process) {
    const { release } = process;
    if (typeof release === "object" && "name" in release && release.name === "node") {
      return "node";
    }
  }
  return "browser";
};

/**
 * The configured engine path, or `""` when the variable does not select one.
 *
 * A blank value is treated as unset, matching how this workspace reads every other optional
 * variable: an absent option arrives as an empty string, and "" is not a path. Reporting the two
 * cases the same way keeps one comparison in the caller instead of a second "is this absent?"
 * question nobody can answer differently.
 *
 * @returns {string} The trimmed configured path, or "" when the variable names none.
 */
const configuredWasmPath = (): string => {
  let configured = "";
  if (typeof process === "object") {
    const { env } = process;
    if (typeof env === "object") {
      configured = env[WASM_PATH_VARIABLE] ?? "";
    }
  }
  const trimmed = configured.trim();
  if (trimmed === "") {
    return "";
  }
  return trimmed;
};

/**
 * Load the package artifact for an explicitly selected runtime boundary.
 *
 * Node reads the packaged file through `node:fs/promises`, or the file `COLANDER_WASM_PATH`
 * names — an absolute path, or one resolved against `process.cwd()` — when that variable is set
 * to a non-blank value. An override that cannot be read is an error naming both the resolved
 * path and the variable, because a silent fallback to the packaged artifact would load an
 * engine the operator did not ask for and hide the mistake. Browsers and Workers use `fetch`
 * against the asset URL emitted from `import.meta.url` and ignore the variable, so a bundler can
 * externalize the Node built-in without changing the browser behavior.
 *
 * @param {WasmAssetLoaderOptions} options Runtime or fetch override.
 * @returns {Promise<BufferSource>} The bundled WebAssembly bytes.
 */
export const loadBundledWasm = async (
  options: WasmAssetLoaderOptions = {},
): Promise<BufferSource> => {
  const runtime = options.runtime ?? detectWasmRuntime();
  if (runtime === "node") {
    // Both built-ins stay dynamic: a bundler externalizes them for the Node branch.
    // A browser bundle that never takes this path must not carry `node:path` at all.
    const { readFile } = await import("node:fs/promises"),
      override = configuredWasmPath();
    if (override === "") {
      return readFile(bundledWasmUrl);
    }
    // Only `node:fs/promises` is allow-listed here; that rule reads a dynamic import as one.
    // The dynamic form is the point of this line, so the rule is opted out of by name instead.
    // eslint-disable-next-line import/no-nodejs-modules, unicorn/import-style -- Node-only, dynamic branch.
    const nodePath = await import("node:path");
    let workingDirectory = ".";
    if (typeof process === "object") {
      workingDirectory = process.cwd();
    }
    const target = nodePath.resolve(workingDirectory, override);
    try {
      return await readFile(target);
    } catch (error) {
      let reason = String(error);
      if (error instanceof Error) {
        reason = error.message;
      }
      throw new Error(`${WASM_PATH_VARIABLE} points at ${target}, which is unreadable: ${reason}`, {
        cause: error,
      });
    }
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchImpl(bundledWasmUrl);
  if (!response.ok) {
    throw new Error(
      `could not load ${bundledWasmUrl.pathname}: ${response.status} ${response.statusText}`,
    );
  }
  return response.arrayBuffer();
};
