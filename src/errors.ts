/**
 * The failure envelope, as an exception.
 *
 * Data-carrying ABI calls return JSON envelopes rather than crossing the
 * WebAssembly boundary with nulls or host exceptions. This class turns the
 * failure envelope into the exception exposed by the TypeScript API.
 */

/** The three kinds colander reports. */
export type ColanderErrorKind = "invalid_request" | "validation" | "panic";

/**
 * A call that colander refused or a WebAssembly trap.
 *
 * - `invalid_request` — the request envelope itself was unusable: a null
 *   pointer, invalid UTF-8, or something that is not a JSON object. From this
 *   binding that is a bug in the binding, not in your data, because the binding
 *   builds the envelope itself.
 * - `validation` — colander parsed the request and rejected the payload. This is
 *   the ordinary "no" and carries the message a user should see.
 * - `panic` — either a Rust panic caught by the C ABI and returned as a normal
 *   failure envelope, or a real WebAssembly trap. A trap bypasses the envelope,
 *   retires the instance, and includes the host's trap text. Load a new instance
 *   with `colander.load()`.
 *
 * The **wording of a message is not part of the contract** — it comes from
 * colander and may change. Match on `code` fields in validation results, never
 * on the text of an exception.
 */
export class ColanderError extends Error {
  public readonly kind: ColanderErrorKind;

  public constructor(kind: ColanderErrorKind, message: string) {
    super(message);
    this.name = "ColanderError";
    this.kind = kind;
  }
}
