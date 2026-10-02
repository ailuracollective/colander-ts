/**
 * One error for everything this package refuses.
 *
 * There was a reason for each of the shapes that existed: a mapping problem, a
 * configuration problem, a template problem. From the outside that distinction is
 * bookkeeping nobody asked for, and a caller that wanted to tell them apart had
 * to catch three classes and remember which one a given message came from. The
 * distinction is kept as a field, where it costs nothing to read and nothing to
 * forget.
 */

/** Which part of the compiler refused, for a caller that wants to branch. */
export type ColanderErrorKind = "mapping" | "config" | "template";

/**
 * A problem with what a consumer declared, or with what a template could emit.
 *
 * The message says what is wrong and, wherever there is one, what to do about
 * it. `subject` names the type or role involved and `path` the file, so a caller
 * can point at something without parsing the sentence.
 */
export class ColanderCompilerError extends Error {
  /** Which part refused. */
  public readonly kind: ColanderErrorKind;
  /** The type or role involved, when there is one. */
  public readonly subject: string | undefined;
  /** The file involved, when there is one. */
  public readonly path: string | undefined;

  public constructor(
    kind: ColanderErrorKind,
    reason: string,
    details: { readonly subject?: string; readonly path?: string } = {},
  ) {
    super(
      kind === "mapping" && details.subject !== undefined
        ? `The component mapping for ${details.subject} is not usable: ${reason}`
        : reason,
    );
    this.name = "ColanderCompilerError";
    this.kind = kind;
    this.subject = details.subject;
    this.path = details.path;
  }
}

/**
 * A problem with the consumer's mapping, named precisely.
 *
 * @param subject the type or role the problem is about
 * @param reason what is wrong, and what to do about it
 * @returns an error naming both
 */
export function mappingError(subject: string, reason: string): ColanderCompilerError {
  return new ColanderCompilerError("mapping", reason, { subject });
}

/**
 * A problem with a configuration file, named precisely.
 *
 * @param path the file the problem is in
 * @param reason what is wrong, and what to do about it
 * @returns an error naming both
 */
export function configError(path: string, reason: string): ColanderCompilerError {
  return new ColanderCompilerError("config", reason, { path });
}

/**
 * A problem the template cannot emit, which the consumer's mapping caused.
 *
 * @param subject the type or role the problem is about
 * @param reason what is wrong, and what to do about it
 * @returns an error naming both
 */
export function templateError(subject: string, reason: string): ColanderCompilerError {
  return new ColanderCompilerError("template", reason, { subject });
}
