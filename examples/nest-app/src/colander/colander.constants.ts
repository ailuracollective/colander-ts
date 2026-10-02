import type { LoadedCore } from "@ailura/colander";
import type { InjectionToken } from "@nestjs/common";

/**
 * Injection token for the loaded form core.
 *
 * A `Symbol` is used instead of a string so the token cannot collide with a
 * string-keyed provider from another module. The type parameter records that
 * the token provides a `LoadedCore`.
 */
export const COLANDER_CORE: InjectionToken<LoadedCore> = Symbol("COLANDER_CORE");
