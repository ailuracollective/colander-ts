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
 * The code a core failure carries in front of its message, as in
 * `REQUEST_TOO_LARGE: request is 67108865 bytes, over the 67108864-byte limit.`
 *
 * The envelope itself has two fields, `kind` and `message`; the code is a prefix
 * of the message, and the core documents that prefix as the branchable part
 * (SPEC C-11) while the wording after the colon is not part of the contract. The
 * pattern therefore accepts a screaming-snake token and nothing looser, so a
 * sentence that merely starts with a capital is not mistaken for a code.
 */
// The capture group is positional, and its index is a constant, because a named group needs a
// Guard this workspace's rules would not let through.
/* eslint-disable-next-line eslint/prefer-named-capture-group */
const CODE_PREFIX = /^([A-Z][A-Z0-9_]*): /u,
  CODE_CAPTURE = 1,
  NO_CODE = "";

/**
 * Reads the failure code out of a core message.
 *
 * An absent code is an empty string, because this workspace bans the null
 * literal and an optional string reads better empty than absent here.
 *
 * @param {string} message The message colander reported.
 * @returns {string} The code, or an empty string when the message carries none.
 */
export const codeOf = (message: string): string => {
  const matched = CODE_PREFIX.exec(message);
  if (matched === null) {
    return NO_CODE;
  }
  return matched[CODE_CAPTURE] ?? NO_CODE;
};

/**
 * A call that colander refused or a WebAssembly trap.
 *
 * - `invalid_request` — the request envelope itself was unusable: a null
 *   pointer, invalid UTF-8, something that is not a JSON object, or a request
 *   over the core's byte cap. From this binding that is a bug in the binding or
 *   an oversized document, not in your data, because the binding builds the
 *   envelope itself.
 * - `validation` — colander parsed the request and rejected the payload. This is
 *   the ordinary "no" and carries the message a user should see.
 * - `panic` — either a Rust panic caught by the C ABI and returned as a normal
 *   failure envelope, or a real WebAssembly trap. A trap bypasses the envelope,
 *   retires the instance, and includes the host's trap text. Load a new instance
 *   with `colander.load()`.
 *
 * `code` is the `SCREAMING_SNAKE` token the message opens with, empty when it
 * opens with prose instead — several core messages, such as
 * `'formSchemaJson' is required and must be a string.`, carry no code at all.
 * Match on `code` (`RULE_*`, `FIELD_*`, `COMPONENT_*`, `REQUEST_TOO_LARGE`,
 * `INVALID_SEMVER`, …) when you need to branch; `kind` alone is too coarse for
 * that and the **wording of a message is never part of the contract**.
 */
export class ColanderError extends Error {
  public readonly kind: ColanderErrorKind;

  /** The branchable failure code, empty when the message carries none. */
  public readonly code: string;

  public constructor(kind: ColanderErrorKind, message: string) {
    super(message);
    this.name = "ColanderError";
    this.kind = kind;
    this.code = codeOf(message);
  }
}
