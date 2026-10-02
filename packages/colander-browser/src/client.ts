import { ColanderError, colander } from "@ailura/colander";
import type {
  CompileRequest,
  CompiledForm,
  ContentHashRequest,
  DescribeFormRequest,
  DescribedForm,
  EvaluateRulesRequest,
  LoadedCore,
  NextVersionRequest,
  ResponseValidation,
  RuleEvaluation,
  SchemaCheck,
  ValidateResponseRequest,
  ValidateSchemaRequest,
} from "@ailura/colander";
import {
  ColanderTransportError,
  isColanderTransportErrorKind,
  toColanderTransportError,
} from "@ailura/colander-client";
import type { CoreInfo } from "@ailura/colander-client";

import { ColanderWebError } from "./errors.js";
import type { ColanderWebErrorKind } from "./errors.js";

/** The identity returned by {@link WebColanderClient.getCore}. */
export interface WebColanderCoreInfo extends CoreInfo {}

/** The small async client exposed by {@link createWebColander}. */
export interface WebColanderClient {
  readonly getCore: () => Promise<WebColanderCoreInfo>;
  readonly compile: (request: CompileRequest) => Promise<CompiledForm>;
  readonly describeForm: (request: DescribeFormRequest) => Promise<DescribedForm>;
  readonly contentHash: (request: ContentHashRequest) => Promise<string>;
  readonly evaluateRules: (request: EvaluateRulesRequest) => Promise<RuleEvaluation>;
  readonly validateResponse: (request: ValidateResponseRequest) => Promise<ResponseValidation>;
  readonly validateSchema: (request: ValidateSchemaRequest) => Promise<SchemaCheck>;
  readonly nextVersion: (request?: NextVersionRequest) => Promise<string>;
}

/** The loader seam keeps lifecycle tests independent of the packaged WASM. */
export type WebColanderLoader = () => Promise<LoadedCore>;

export interface WebColanderOptions {
  /** Test or host-level loader override; production uses colander.load(). */
  readonly loadCore?: WebColanderLoader;
}

function hasTransportKind(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    isColanderTransportErrorKind((error as { kind?: unknown }).kind)
  );
}

function asWebError(error: unknown, kind: ColanderWebErrorKind): unknown {
  if (error instanceof ColanderError || error instanceof ColanderTransportError) {
    return error;
  }

  const adapted = toColanderTransportError(error, kind);
  if (hasTransportKind(error)) {
    return adapted;
  }
  return new ColanderWebError(kind, adapted.message, {
    ...(adapted.detail === undefined ? {} : { detail: adapted.detail }),
    cause: error,
  });
}

function isPanic(error: unknown): boolean {
  return toColanderTransportError(error).kind === "panic";
}

/**
 * Create a browser-side client around the packed main Colander package.
 *
 * The core is loaded lazily. Concurrent calls share one promise, a rejected load
 * is forgotten so a later call can retry, and a core that reports a real panic
 * is discarded without affecting other client instances. Core and neutral
 * transport errors retain their original category; only boundary failures are
 * wrapped as browser unavailable or operation errors.
 */
export function createWebColander(options: WebColanderOptions = {}): WebColanderClient {
  const loadCore = options.loadCore ?? (async () => colander.load());
  let loadPromise: Promise<LoadedCore> | null = null;

  const forget = (pending: Promise<LoadedCore>): void => {
    // A stale operation from an older core must not evict a newer recovery.
    if (loadPromise === pending) {
      loadPromise = null;
    }
  };

  /**
   * The shared load, and the promise that identifies it.
   *
   * This is deliberately **not** an `async` function. An async function always
   * returns a fresh promise that adopts its result, so a caller holding that
   * promise could never be identity-equal to the one stored in `loadPromise` —
   * and `forget` compares by identity to avoid evicting a newer recovery. With
   * `async` here, a panicked core stayed cached forever: `forget` silently did
   * nothing, every later call reused the trapped core, and the client never
   * recovered. The rejected-load path kept working because it compares inside
   * this function, against the promise created here, where the identity does
   * hold.
   */
  const load = async (): Promise<LoadedCore> => {
    if (loadPromise !== null) {
      return loadPromise;
    }

    const pending = Promise.resolve()
      .then(loadCore)
      .catch((error: unknown) => {
        throw asWebError(error, "unavailable");
      });
    loadPromise = pending;
    void pending.then(
      () => {},
      () => {
        if (loadPromise === pending) {
          loadPromise = null;
        }
      },
    );
    return pending;
  };

  const invoke = async <Result>(operation: (core: LoadedCore) => Result): Promise<Result> => {
    const pending = load();
    const core = await pending;
    try {
      return operation(core);
    } catch (error) {
      if (isPanic(error)) {
        forget(pending);
      }
      throw asWebError(error, "operation");
    }
  };

  return {
    compile: async (request) => invoke((core) => core.compile(request)),
    contentHash: async (request) => invoke((core) => core.contentHash(request)),
    describeForm: async (request) => invoke((core) => core.describeForm(request)),
    evaluateRules: async (request) => invoke((core) => core.evaluateRules(request)),
    getCore: async () =>
      invoke<WebColanderCoreInfo>((core) => ({
        abiVersion: core.abiVersion,
        versionInfo: core.versionInfo(),
      })),
    nextVersion: async (request) => invoke((core) => core.nextVersion(request)),
    validateResponse: async (request) => invoke((core) => core.validateResponse(request)),
    validateSchema: async (request) => invoke((core) => core.validateSchema(request)),
  };
}
