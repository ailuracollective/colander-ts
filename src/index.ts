/**
 * Package: @ailuracode/colander — the colander form core, from TypeScript.
 *
 * ```ts
 * import { colander } from "@ailuracode/colander";
 *
 * const core = await colander.load();
 * const compiled = core.compile({ formSchemaJson });
 * ```
 *
 * The core is a Rust library compiled to WebAssembly; this package is the
 * boundary, not a reimplementation. The binary ships inside the package and has
 * no imports, so the module is instantiated with `{}` — the same C ABI a native
 * caller drives.
 *
 * Two things to know before reading further:
 *
 * - **Documents travel as JSON text.** `formSchemaJson` is a string containing
 *   JSON, not an object. The core preserves number literals and the content
 *   hash covers the bytes, so `JSON.stringify` on the way in is usually a bug.
 * - **Failures throw.** Every method except `validateSchema` turns the ABI's
 *   failure envelope into a `ColanderError`.
 * - **A WebAssembly trap ends the instance.** The host reports the trap text,
 *   retires the instance, and requires a new `colander.load()`.
 */

import type {
  CompileRequest,
  CompiledForm,
  ContentHashRequest,
  EvaluateRulesRequest,
  NextVersionRequest,
  ResponseValidation,
  RuleEvaluation,
  SchemaCheck,
  ValidateResponseRequest,
  ValidateSchemaRequest,
  VersionInfo,
} from "./types.ts";
import { getAbiVersion, instantiate, invoke, invokeNoRequest, unwrap } from "./wasm.ts";
import type { ColanderExports, WasmSource } from "./wasm.ts";

export { ColanderError } from "./errors.ts";
export type { ColanderErrorKind } from "./errors.ts";
export type * from "./types.ts";
export { COLANDER_ABI_VERSION } from "./wasm.ts";
export type { ColanderExports } from "./wasm.ts";

/**
 * A loaded form core.
 *
 * One instance is enough for a process: calls hold no state between them, so
 * there is nothing to reset. A real WebAssembly trap ends an instance, so a
 * retired instance refuses further calls and `load` gives you a fresh one.
 * `load` is `async` because instantiation is.
 */
export interface LoadedCore {
  readonly abiVersion: number;
  readonly compile: (request: CompileRequest) => CompiledForm;
  readonly evaluateRules: (request: EvaluateRulesRequest) => RuleEvaluation;
  readonly validateResponse: (request: ValidateResponseRequest) => ResponseValidation;
  readonly validateSchema: (request: ValidateSchemaRequest) => SchemaCheck;
  readonly contentHash: (request: ContentHashRequest) => string;
  readonly nextVersion: (request?: NextVersionRequest) => string;
  readonly versionInfo: () => VersionInfo;
}

const createCore = (wasm: ColanderExports): LoadedCore => ({
  get abiVersion() {
    return getAbiVersion(wasm);
  },

  /**
   * Expand `component-ref` fields, canonicalize the triple and hash it.
   *
   * This is the call to make before storing or publishing a form. The result's
   * `contentHash` is what identifies the form version.
   *
   * @param {CompileRequest} request Form and schema documents to compile.
   * @returns {CompiledForm} The canonical compiled form.
   */
  compile(request: CompileRequest): CompiledForm {
    return unwrap(invoke<CompiledForm>(wasm, (pointer) => wasm.colander_compile(pointer), request));
  },

  /**
   * Hash a form/ui/rules triple **as given**, with no compilation.
   *
   * Pinned byte for byte to a canonical serialization: key order, escaping and
   * number literals all feed the digest. Two documents that differ only in
   * whitespace hash the same; two that differ in key order do not.
   *
   * @param {ContentHashRequest} request Form, UI, and rules documents to hash.
   * @returns {string} The lowercase hexadecimal digest.
   */
  contentHash(request: ContentHashRequest): string {
    const result = unwrap(
      invoke<{ contentHash: string }>(
        wasm,
        (pointer) => wasm.colander_content_hash(pointer),
        request,
      ),
    );
    return result.contentHash;
  },

  /**
   * Evaluate the rules against a set of values — the live-form call.
   *
   * Mind the keying: `visibility`, `enabled` and `required` are keyed by field
   * **id**, while `calculatedValues` is keyed by field **code**. Every field
   * appears in the three boolean maps whether or not it has a rule.
   *
   * @param {EvaluateRulesRequest} request Documents and current values.
   * @returns {RuleEvaluation} Visibility, enablement, required state, and calculated values.
   */
  evaluateRules(request: EvaluateRulesRequest): RuleEvaluation {
    return unwrap(
      invoke<RuleEvaluation>(wasm, (pointer) => wasm.colander_evaluate_rules(pointer), request),
    );
  },

  /**
   * Pick the next patch version above everything published.
   *
   * The parser here is deliberately permissive and is **not** semver-strict:
   * `1..0.0` and `01.0.0` are accepted and `1.0.0-beta` is rejected.
   *
   * @param {NextVersionRequest} request Published versions to consider.
   * @returns {string} The next patch version.
   */
  nextVersion(request?: NextVersionRequest): string {
    const result = unwrap(
      invoke<{ next: string }>(
        wasm,
        (pointer) => wasm.colander_next_version(pointer),
        request ?? {},
      ),
    );
    return result.next;
  },

  /**
   * Validate and normalize submitted answers — the acceptance call.
   *
   * A rejected answer is **not** an exception: it comes back with
   * `isValid: false` and an `errors` array. This method throws only when the
   * request itself is unusable.
   *
   * @param {ValidateResponseRequest} request Documents and submitted answers.
   * @returns {ResponseValidation} Normalized answers and validation errors.
   */
  validateResponse(request: ValidateResponseRequest): ResponseValidation {
    return unwrap(
      invoke<ResponseValidation>(
        wasm,
        (pointer) => wasm.colander_validate_response(pointer),
        request,
      ),
    );
  },

  /**
   * Validate a document against a JSON Schema you supply.
   *
   * colander ships no schemas: `schemas` carries the text of whichever ones
   * the call needs. This is the one method that does **not** throw on an
   * invalid document, because "invalid" is a validator's ordinary answer. The
   * ABI reports it as a failure envelope and never as `valid: false`, so the
   * envelope is turned back into a result here.
   *
   * For `kind: "form"` this also runs the rule dependency check, which is the
   * only place the `RULE_*` codes can surface.
   *
   * @param {ValidateSchemaRequest} request Document and schema inputs.
   * @returns {SchemaCheck} The schema outcome.
   */
  validateSchema(request: ValidateSchemaRequest): SchemaCheck {
    const envelope = invoke<{ valid: true }>(
      wasm,
      (pointer) => wasm.colander_validate_schema(pointer),
      request,
    );
    if (envelope.ok) {
      return { valid: true };
    }
    return { message: envelope.error.message, valid: false };
  },

  /**
   * Name, crate version and ABI version of the loaded module.
   *
   * @returns {VersionInfo} The module identity.
   */
  versionInfo(): VersionInfo {
    return unwrap(invokeNoRequest<VersionInfo>(wasm, () => wasm.colander_version_info()));
  },
});

/**
 * The public loader for the colander form core.
 *
 * With no argument, `load` reads `wasm/colander.wasm` shipped by this package:
 * from disk under Node and over `fetch` elsewhere. Pass bytes or a
 * `WebAssembly.Module` to load it yourself, which is useful in a browser,
 * Worker, or another environment with a strict CSP.
 */
declare const process: { versions: Record<string, string> } | undefined;

const bundledWasmUrl = new URL("../wasm/colander.wasm", import.meta.url),
  /**
   * Load the package artifact without making browser builds resolve Node built-ins.
   *
   * `new URL(..., import.meta.url)` also lets bundlers that understand asset URLs
   * copy or inline the WebAssembly file.
   *
   * @returns {Promise<BufferSource>} The bundled WebAssembly bytes.
   */
  loadBundledWasm = async (): Promise<BufferSource> => {
    if (typeof process !== "undefined") {
      const { readFile } = await import("node:fs/promises");
      return readFile(bundledWasmUrl);
    }

    const response = await fetch(bundledWasmUrl);
    if (!response.ok) {
      throw new Error(
        `could not load ${bundledWasmUrl.pathname}: ${response.status} ${response.statusText}`,
      );
    }
    return response.arrayBuffer();
  },
  colander = {
    load: async (source?: WasmSource): Promise<LoadedCore> => {
      const bytes = source ?? (await loadBundledWasm());
      return createCore(await instantiate(bytes));
    },
  };

export { colander };
