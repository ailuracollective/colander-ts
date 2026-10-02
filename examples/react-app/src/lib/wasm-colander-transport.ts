import { createWebColander, type WebColanderLoader } from "@ailura/colander-browser";
import type { ColanderTransport } from "@ailura/colander-client";

/** The browser package owns loading, retry, and panic recovery. */
export type WasmCoreLoader = WebColanderLoader;

export interface WasmColanderTransportOptions {
  loadCore?: WasmCoreLoader;
}

/**
 * Compatibility factory for the React example.
 *
 * The returned port is the canonical browser lifecycle client; this module
 * intentionally contains no second cache, loader, or error implementation.
 */
export function createWasmColanderTransport(
  options: WasmColanderTransportOptions = {},
): ColanderTransport {
  return createWebColander(options);
}

/** The React example's source-specific direct transport. */
export const wasmColanderTransport = createWasmColanderTransport();
