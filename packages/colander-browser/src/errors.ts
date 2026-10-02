import { ColanderTransportError } from "@ailura/colander-client";
import type { ColanderTransportErrorOptions } from "@ailura/colander-client";

/** Failure categories added by the browser lifecycle itself. */
export type ColanderWebErrorKind = "unavailable" | "operation";

export type ColanderWebErrorOptions = Omit<
  ColanderTransportErrorOptions<ColanderWebErrorKind>,
  "kind"
>;

/**
 * Compatibility name for browser lifecycle failures.
 *
 * The class is a specialization of the client package's neutral transport
 * error, so consumers can handle one discriminated model across sources.
 */
export class ColanderWebError extends ColanderTransportError<ColanderWebErrorKind> {
  public constructor(
    kind: ColanderWebErrorKind,
    message: string,
    options: ColanderWebErrorOptions = {},
  ) {
    super(message, { ...options, kind });
    this.name = "ColanderWebError";
  }
}
