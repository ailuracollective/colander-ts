/**
 * The WebAssembly surface, and the memory discipline it demands.
 *
 * Nothing here is colander-specific: it is the cost of a C ABI without a C runtime. The host has no
 * allocator for the guest's heap, so the guest hands one out (`colander_alloc` /
 * `colander_free_buffer`) and the host copies the request into linear memory by hand.
 *
 * One rule matters more than the rest: **never hold a `Uint8Array` across a call.** Growing linear
 * memory detaches the old `ArrayBuffer`, and a stale view does not throw — it reads as a zero-length
 * array, so the bug surfaces as a hang or a wrong answer. Every access below takes a fresh view.
 *
 * The C ABI catches ordinary Rust panics and returns them as error envelopes. A real WebAssembly
 * trap bypasses that envelope, so the binding reports the host's trap text and retires the instance
 * instead of calling into uncertain guest state again.
 */

import { ColanderError, codeOf } from "./errors.ts";
import type { ColanderErrorKind } from "./errors.ts";
import { COLANDER_MAX_REQUEST_BYTES } from "./limits.ts";
import type { SchemaResult } from "./types.ts";

/** The ABI this binding is written against. */
export const COLANDER_ABI_VERSION = 1;

/** The functions published by the colander WebAssembly module. */
export interface ColanderExports {
  readonly memory: WebAssembly.Memory;
  readonly colander_abi_version: () => number;
  readonly colander_version_info: () => number;
  readonly colander_compile: (request: number) => number;
  readonly colander_describe_form: (request: number) => number;
  readonly colander_evaluate_rules: (request: number) => number;
  readonly colander_validate_response: (request: number) => number;
  readonly colander_validate_schema: (request: number) => number;
  readonly colander_content_hash: (request: number) => number;
  readonly colander_next_version: (request: number) => number;
  readonly colander_alloc: (length: number) => number;
  readonly colander_free_buffer: (pointer: number, length: number) => void;
  readonly colander_free_string: (pointer: number) => void;
}

/** Anything `WebAssembly.compile` accepts, or an already-compiled module. */
export type WasmSource = BufferSource | WebAssembly.Module;

/** The envelope, before it becomes a result or an exception. */
export type Envelope<Result> =
  | { ok: true; result: Result }
  | { ok: false; error: { kind: ColanderErrorKind; message: string } };

const REQUIRED_EXPORTS = [
    "colander_compile",
    "colander_describe_form",
    "colander_evaluate_rules",
    "colander_validate_response",
    "colander_validate_schema",
    "colander_content_hash",
    "colander_next_version",
    "colander_version_info",
    "colander_abi_version",
    "colander_alloc",
    "colander_free_buffer",
    "colander_free_string",
  ] as const,
  EMPTY_POINTER = 0,
  NUL_TERMINATOR = 0,
  REQUEST_TERMINATOR_BYTES = 1,
  RETIRED =
    "This WebAssembly instance cannot be reused after a trap; load a new one with colander.load().",
  // The neutral lint environment declares none of these globals: `globalThis` names the same ones.
  decoder = new globalThis.TextDecoder(),
  encoder = new globalThis.TextEncoder(),
  retired = new WeakSet<ColanderExports>();

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isErrorKind = (value: unknown): value is ColanderErrorKind =>
  value === "invalid_request" || value === "validation" || value === "panic";

const isEnvelope = <Result>(value: unknown): value is Envelope<Result> => {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }
  if (value.ok) {
    return "result" in value;
  }
  const { error } = value;
  return isRecord(error) && isErrorKind(error.kind) && typeof error.message === "string";
};

const hasColanderExports = (value: unknown): value is ColanderExports => {
  if (!isRecord(value)) {
    return false;
  }
  const { memory } = value;
  if (!(memory instanceof globalThis.WebAssembly.Memory)) {
    return false;
  }
  return REQUIRED_EXPORTS.every((name) => typeof value[name] === "function");
};

const requireUsable = (wasm: ColanderExports): void => {
  if (retired.has(wasm)) {
    throw new ColanderError("panic", RETIRED);
  }
};

const retire = (wasm: ColanderExports, trap: unknown): ColanderError => {
  retired.add(wasm);
  let trapped = String(trap);
  if (trap instanceof Error) {
    trapped = trap.message;
  }
  return new ColanderError("panic", `WebAssembly trap: ${trapped}. ${RETIRED}`);
};

const readString = (wasm: ColanderExports, pointer: number): string => {
  const view = new Uint8Array(wasm.memory.buffer);
  let end = pointer;
  while (end < view.length && view[end] !== NUL_TERMINATOR) {
    end += REQUEST_TERMINATOR_BYTES;
  }
  return decoder.decode(view.subarray(pointer, end));
};

const readText = (wasm: ColanderExports, pointer: number): string => {
  try {
    return readString(wasm, pointer);
  } catch (error) {
    throw retire(wasm, error);
  }
};

const readEnvelope = <Result>(wasm: ColanderExports, pointer: number): Envelope<Result> => {
  const text = readText(wasm, pointer);
  try {
    wasm.colander_free_string(pointer);
  } catch (error) {
    throw retire(wasm, error);
  }
  const parsed: unknown = JSON.parse(text);
  if (!isEnvelope<Result>(parsed)) {
    throw new Error("colander returned an invalid response envelope");
  }
  return parsed;
};

/**
 * Instantiate the module and check that it is one this binding can drive.
 *
 * @param {WasmSource} source WebAssembly bytes or an already-compiled module.
 * @returns {Promise<ColanderExports>} The validated WebAssembly exports.
 */
export const instantiate = async (source: WasmSource): Promise<ColanderExports> => {
  let compiledModule: WebAssembly.Module;
  if (source instanceof globalThis.WebAssembly.Module) {
    compiledModule = source;
  } else {
    compiledModule = await globalThis.WebAssembly.compile(source);
  }
  const instance = await globalThis.WebAssembly.instantiate(compiledModule, {}),
    exports: unknown = instance.exports;
  if (!isRecord(exports)) {
    throw new TypeError("the WebAssembly module did not return an exports object");
  }
  for (const name of REQUIRED_EXPORTS) {
    if (typeof exports[name] !== "function") {
      throw new TypeError(
        `the WebAssembly module does not export ${name}(); rebuild it with \`pnpm exec vp run build:wasm\``,
      );
    }
  }
  if (!hasColanderExports(exports)) {
    throw new Error("the WebAssembly module does not export its memory");
  }
  const abi = exports.colander_abi_version();
  if (abi !== COLANDER_ABI_VERSION) {
    throw new Error(
      `this binding speaks ABI ${COLANDER_ABI_VERSION} but the module reports ${abi}`,
    );
  }
  return exports;
};

/**
 * Read the loaded module's ABI without calling into a retired instance.
 *
 * @param {ColanderExports} wasm Instance to query.
 * @returns {number} The ABI version reported by the guest.
 */
export const getAbiVersion = (wasm: ColanderExports): number => {
  requireUsable(wasm);
  try {
    return wasm.colander_abi_version();
  } catch (error) {
    throw retire(wasm, error);
  }
};

/**
 * Make one JSON request and return its envelope, refusing a request over the core's byte cap.
 *
 * @param {ColanderExports} wasm Instance to call.
 * @param {(request: number) => number} entry ABI function receiving the request pointer.
 * @param {unknown} request JSON-serializable request value.
 * @returns {Envelope<Result>} The decoded response envelope.
 */
export const invoke = <Result>(
  wasm: ColanderExports,
  entry: (request: number) => number,
  request: unknown,
): Envelope<Result> => {
  requireUsable(wasm);
  const bytes = encoder.encode(JSON.stringify(request)),
    length = bytes.length + REQUEST_TERMINATOR_BYTES;
  if (length > COLANDER_MAX_REQUEST_BYTES) {
    // The core's own kind and code, so a caller that respects the cap cannot tell this refusal apart.
    throw new ColanderError(
      "invalid_request",
      `REQUEST_TOO_LARGE: request is ${length} bytes, over the ${COLANDER_MAX_REQUEST_BYTES}-byte limit.`,
    );
  }
  let buffer = EMPTY_POINTER,
    pointer = EMPTY_POINTER;

  try {
    buffer = wasm.colander_alloc(length);
    if (buffer === EMPTY_POINTER) {
      throw new Error(`colander_alloc(${length}) returned null`);
    }
    const view = new Uint8Array(wasm.memory.buffer);
    view.set(bytes, buffer);
    view[buffer + bytes.length] = NUL_TERMINATOR;
    pointer = entry(buffer);
  } catch (error) {
    throw retire(wasm, error);
  }

  try {
    wasm.colander_free_buffer(buffer, length);
  } catch (error) {
    throw retire(wasm, error);
  }
  return readEnvelope<Result>(wasm, pointer);
};

/**
 * Call an entry point that takes no request.
 *
 * @param {ColanderExports} wasm Instance to call.
 * @param {() => number} entry ABI function taking no request.
 * @returns {Envelope<Result>} The decoded response envelope.
 */
export const invokeNoRequest = <Result>(
  wasm: ColanderExports,
  entry: () => number,
): Envelope<Result> => {
  requireUsable(wasm);
  let pointer = EMPTY_POINTER;
  try {
    pointer = entry();
  } catch (error) {
    throw retire(wasm, error);
  }
  return readEnvelope<Result>(wasm, pointer);
};

/**
 * Turn an envelope into a result, or into a `ColanderError`.
 *
 * @param {Envelope<Result>} envelope Envelope returned by an ABI call.
 * @returns {Result} The successful result.
 */
export const unwrap = <Result>(envelope: Envelope<Result>): Result => {
  if (envelope.ok) {
    return envelope.result;
  }
  throw new ColanderError(envelope.error.kind, envelope.error.message);
};

/**
 * Turn a schema-validation envelope into its public result.
 *
 * Only the core's ordinary `validation` envelope means that the submitted document is invalid.
 * `invalid_request` and `panic` are typed core failures and must remain exceptions. The invalid
 * branch keeps the failure `code` beside the message, because this is the one call where a schema
 * rejection is an answer rather than an exception.
 *
 * @param {Envelope<{ valid: true }>} envelope Schema result envelope.
 * @returns {SchemaResult} The public schema result.
 */
export const unwrapSchema = (envelope: Envelope<{ valid: true }>): SchemaResult => {
  if (envelope.ok) {
    return { valid: true };
  }
  if (envelope.error.kind === "validation") {
    return { code: codeOf(envelope.error.message), message: envelope.error.message, valid: false };
  }
  throw new ColanderError(envelope.error.kind, envelope.error.message);
};
