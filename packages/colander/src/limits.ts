/**
 * The one bound the core puts on a caller, kept in its own module so the
 * binding and the request path cannot disagree about it.
 */
/* eslint-disable import/prefer-default-export */

const BYTES_PER_MEBIBYTE = 1_048_576,
  REQUEST_CAP_MEBIBYTES = 64;

/**
 * The largest request the core will parse, in bytes.
 *
 * The bound belongs to the boundary because that is the only place that sees the
 * caller's byte count before allocating (SPEC C-10), and the core reports an
 * over-cap request as `REQUEST_TOO_LARGE`. The binding checks the same number
 * before the copy into linear memory, so an oversized document costs a byte count
 * rather than a 64 MiB allocation and a round trip. The cap is far above any
 * documented form: it makes the bound explicit, it is not a product limit.
 */
export const COLANDER_MAX_REQUEST_BYTES = REQUEST_CAP_MEBIBYTES * BYTES_PER_MEBIBYTE;
