/**
 * The failure categories reported by the Colander core.
 *
 * A compile-time mirror of the ABI value, for typing only. Nothing in this
 * package tests a value against it at runtime; see
 * `isColanderTransportErrorKind` for the structural check.
 */
export type ColanderErrorKind = "invalid_request" | "validation" | "panic";

/**
 * Categories an adapter can use when it cannot return a core result.
 *
 * The core's own categories are not listed here on purpose. The core owns that
 * vocabulary; this package only adds the transport failures a source can raise
 * on its own, and recognises a core category structurally instead of naming it.
 */
export type ColanderTransportErrorKind = ColanderErrorKind | ColanderSourceErrorKind;

/** The failure categories a delivery source can raise without the core. */
export type ColanderSourceErrorKind = "unavailable" | "network" | "operation" | "unknown";

/** Every category a `ColanderTransportError` can carry. */
export type ColanderAnyErrorKind = ColanderErrorKind | ColanderSourceErrorKind;

/** The structured failure data shared by core-compatible adapters. */
export interface ColanderErrorBody {
  readonly kind: ColanderErrorKind;
  readonly message: string;
  readonly detail?: string;
}

/** The source-neutral discriminated failure shape used at every adapter boundary. */
export interface ColanderFailureBody {
  readonly kind: ColanderTransportErrorKind;
  readonly message: string;
  readonly detail?: string;
}

/** A discriminated union for consumers that model failures as data. */
export type ColanderFailure = {
  [Kind in ColanderTransportErrorKind]: {
    readonly kind: Kind;
    readonly message: string;
    readonly detail?: string;
  };
}[ColanderTransportErrorKind];

export interface ColanderTransportErrorOptions<
  Kind extends ColanderTransportErrorKind = ColanderTransportErrorKind,
> {
  readonly kind?: Kind;
  readonly detail?: string;
  readonly cause?: unknown;
}

/**
 * A source-neutral operation failure.
 *
 * The category and message are the stable information available to a caller.
 * Delivery-specific metadata belongs to an adapter and is deliberately not part
 * of this class.
 */
export class ColanderTransportError<
  Kind extends ColanderTransportErrorKind = ColanderTransportErrorKind,
>
  extends Error
  implements ColanderFailureBody
{
  public readonly kind: Kind;
  public readonly detail?: string;

  public constructor(message: string, options: ColanderTransportErrorOptions<Kind> = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ColanderTransportError";
    this.kind = options.kind ?? ("unknown" as Kind);
    if (options.detail !== undefined) {
      this.detail = options.detail;
    }
  }
}

export function isColanderSourceErrorKind(value: unknown): value is ColanderSourceErrorKind {
  return (
    value === "unavailable" || value === "network" || value === "operation" || value === "unknown"
  );
}

/**
 * Recognise any core or source category without restating the core's list.
 *
 * The core's three kinds are a published ABI value, so a hardcoded copy here
 * would be a second place to update and a second place to get wrong. Matching
 * the shape keeps this package correct when the core adds a kind; the binding
 * that talks to the core is the one place that names them.
 */
export function isColanderTransportErrorKind(value: unknown): value is ColanderTransportErrorKind {
  return isColanderSourceErrorKind(value) || (typeof value === "string" && value.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Adapt a structurally compatible error without losing its category.
 *
 * This helper intentionally recognizes errors by their public shape as well as
 * by class identity, so a core, browser, or HTTP error can cross a boundary
 * without being collapsed into a generic operation failure.
 */
export function toColanderTransportError(
  error: unknown,
  fallbackKind: ColanderTransportErrorKind = "unknown",
): ColanderTransportError {
  if (error instanceof ColanderTransportError) {
    return error;
  }
  if (
    isRecord(error) &&
    isColanderTransportErrorKind(error["kind"]) &&
    typeof error["message"] === "string"
  ) {
    return new ColanderTransportError(error["message"], {
      kind: error["kind"],
      ...(typeof error["detail"] === "string" ? { detail: error["detail"] } : {}),
      cause: error,
    });
  }
  if (error instanceof Error) {
    return new ColanderTransportError(error.message, { cause: error, kind: fallbackKind });
  }
  return new ColanderTransportError(String(error), { cause: error, kind: "unknown" });
}
