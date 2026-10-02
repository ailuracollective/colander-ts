import {
  ColanderTransportError,
  isColanderTransportErrorKind,
  toColanderTransportError,
  type ColanderTransport,
  type ColanderTransportErrorKind,
  type CompileRequest,
  type DescribeFormRequest,
  type DescribedForm,
  type CompiledForm,
  type ContentHashRequest,
  type CoreInfo,
  type EvaluateRulesRequest,
  type NextVersionRequest,
  type ResponseValidation,
  type RuleEvaluation,
  type SchemaCheck,
  type ValidateResponseRequest,
  type ValidateSchemaRequest,
} from "@ailura/colander-client";

import { ColanderApiError } from "./http-colander-transport";

export { ColanderApiError, toColanderApiError } from "./http-colander-transport";
export type { ApiErrorKind } from "./http-colander-transport";

/** A source-neutral API facade whose delivery is selected by the caller. */
export interface ColanderApi {
  readonly getCore: () => Promise<CoreInfo>;
  readonly compile: (request: CompileRequest) => Promise<CompiledForm>;
  readonly describeForm: (request: DescribeFormRequest) => Promise<DescribedForm>;
  readonly contentHash: (request: ContentHashRequest) => Promise<string>;
  readonly evaluateRules: (request: EvaluateRulesRequest) => Promise<RuleEvaluation>;
  readonly validateResponse: (request: ValidateResponseRequest) => Promise<ResponseValidation>;
  readonly validateSchema: (request: ValidateSchemaRequest) => Promise<SchemaCheck>;
  readonly nextVersion: (request?: NextVersionRequest) => Promise<string>;
}

export function createColanderApi(selectedTransport: ColanderTransport): ColanderApi {
  return {
    getCore: () => selectedTransport.getCore(),
    compile: (request) => selectedTransport.compile(request),
    describeForm: (request) => selectedTransport.describeForm(request),
    contentHash: (request) => selectedTransport.contentHash(request),
    evaluateRules: (request) => selectedTransport.evaluateRules(request),
    validateResponse: (request) => selectedTransport.validateResponse(request),
    validateSchema: (request) => selectedTransport.validateSchema(request),
    nextVersion: (request) => selectedTransport.nextVersion(request),
  };
}

export type ColanderSourceErrorKind = ColanderTransportErrorKind;

export interface ColanderSourceError {
  readonly kind: ColanderSourceErrorKind;
  readonly message: string;
  readonly detail?: string;
  readonly status?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Normalize source errors without turning a core validation into a network error. */
export function toColanderSourceError(error: unknown): ColanderSourceError {
  if (error instanceof ColanderApiError) {
    return {
      kind: error.kind,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
      ...(error.status === undefined ? {} : { status: error.status }),
    };
  }
  if (error instanceof ColanderTransportError) {
    return {
      kind: error.kind,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    };
  }
  if (isRecord(error) && isColanderTransportErrorKind(error.kind)) {
    const normalized = toColanderTransportError(error);
    return {
      kind: normalized.kind,
      message: normalized.message,
      ...(normalized.detail === undefined ? {} : { detail: normalized.detail }),
    };
  }
  if (error instanceof Error) {
    return { kind: "unknown", message: error.message };
  }
  return { kind: "unknown", message: String(error) };
}
