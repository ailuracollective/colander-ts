/**
 * Package: @ailura/colander — the colander form core, from TypeScript.
 *
 * ```ts
 * import { colander } from "@ailura/colander";
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
 * Five things to know before reading further:
 *
 * - **Documents travel as JSON text.** `formSchemaJson` is a string containing
 *   JSON, not an object. The core preserves number literals and the content
 *   hash covers the bytes, so `JSON.stringify` on the way in is usually a bug.
 * - **An optional key is omitted, never `null`.** "Absent" takes the core's
 *   default; a present value of the wrong JSON type is a failure (SPEC C-6).
 * - **Failures throw.** Every method except `validateSchema` turns the ABI's
 *   failure envelope into a `ColanderError`, which carries the core's branchable
 *   `code` beside the message.
 * - **A request is capped** at `COLANDER_MAX_REQUEST_BYTES`, the core's own bound.
 * - **A WebAssembly trap ends the instance**, which then needs a new `colander.load()`.
 */

import { loadBundledWasm } from "./loader.ts";
import type {
  CompileRequest,
  CompiledForm,
  ContentHashRequest,
  DescribeFormRequest,
  DescribedForm,
  EvaluateRulesRequest,
  NextVersionRequest,
  ResponseValidation,
  RuleEvaluation,
  SchemaCheck,
  ValidateResponseRequest,
  ValidateSchemaRequest,
  VersionInfo,
} from "./types.ts";
import {
  getAbiVersion,
  instantiate,
  invoke,
  invokeNoRequest,
  unwrap,
  unwrapSchema,
} from "./wasm.ts";
import type { ColanderExports, WasmSource } from "./wasm.ts";

export { ColanderError } from "./errors.ts";
export type { ColanderErrorKind } from "./errors.ts";
export type * from "./types.ts";
export { COLANDER_ABI_VERSION } from "./wasm.ts";
export { COLANDER_MAX_REQUEST_BYTES } from "./limits.ts";
export type { ColanderExports, WasmSource } from "./wasm.ts";
export { loadBundledWasm } from "./loader.ts";
export type { WasmAssetLoaderOptions, WasmRuntime } from "./loader.ts";

/**
 * A loaded form core.
 *
 * One instance is enough for a process: calls hold no state between them, so there is nothing to
 * reset. A real WebAssembly trap ends an instance, so a retired instance refuses further calls and
 * `load` gives you a fresh one. `load` is `async` because instantiation is.
 */
export interface LoadedCore {
  readonly abiVersion: number;
  readonly compile: (request: CompileRequest) => CompiledForm;
  readonly describeForm: (request: DescribeFormRequest) => DescribedForm;
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
   * Report the field index of a compiled triple.
   *
   * Prefer this over reparsing the compiled `formSchemaJson`: the pointers and
   * the per-field flags come from the index the core built when it validated the
   * document, so they cannot drift from the paths `validateResponse` reports.
   * Presentation is not described — a field's `title` and `description` stay the
   * caller's, and a layout node's title travels in the compiled UI document.
   *
   * @param {DescribeFormRequest} request The documents to describe.
   * @returns {DescribedForm} Every field, in document order.
   */
  describeForm(request: DescribeFormRequest): DescribedForm {
    return unwrap(
      invoke<DescribedForm>(wasm, (pointer) => wasm.colander_describe_form(pointer), request),
    );
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
   * Pick the next version above everything published.
   *
   * The parser is **strict**: exactly three ASCII-digit segments, no leading zero, no pre-release
   * or build metadata, so `1..0.0`, `01.0.0` and `1.0.0-beta` are each rejected with
   * `INVALID_SEMVER`. `bump` chooses how far to move — `"patch"` (the default), `"minor"` or
   * `"major"` — and `["1.2.3", "1.10.0", "1.9.9"]` yields `1.10.1`, `1.11.0` and `2.0.0`. With
   * nothing published the answer is `"1.0.0"`.
   *
   * @param {NextVersionRequest} request Published versions and the bump to apply.
   * @returns {string} The next version.
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
   * envelope is turned back into a result here, failure `code` included.
   *
   * For `kind: "form"` this also runs the rule dependency check, which is the
   * only place the `RULE_*` codes can surface. For `kind: "workflow"` the core
   * **rejects** a `published` key outright, so this request type does not offer
   * one: an accepted no-op is a trap.
   *
   * @param {ValidateSchemaRequest} request Document and schema inputs.
   * @returns {SchemaCheck} The schema outcome.
   */
  validateSchema(request: ValidateSchemaRequest): SchemaCheck {
    return unwrapSchema(
      invoke<{ valid: true }>(wasm, (pointer) => wasm.colander_validate_schema(pointer), request),
    );
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

const colander = {
  load: async (source?: WasmSource): Promise<LoadedCore> => {
    const bytes = source ?? (await loadBundledWasm());
    return createCore(await instantiate(bytes));
  },
};

export { colander };
