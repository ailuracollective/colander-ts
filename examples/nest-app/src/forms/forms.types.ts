import type {
  CompileRequest,
  ContentHashRequest,
  DescribeFormRequest,
  EvaluateRulesRequest,
  NextVersionRequest,
  ValidateResponseRequest,
  ValidateSchemaRequest,
} from "@ailura/colander";

/**
 * HTTP request bodies for the forms endpoints.
 *
 * These are the library's own request shapes, not a second contract. Every
 * `…Json` field is JSON **text**: the core hashes the bytes it receives, so an
 * HTTP body must carry a string and must never be a parsed document that the
 * controller would re-serialize.
 */
export type CompileBody = CompileRequest;
export type DescribeFormBody = DescribeFormRequest;
export type ContentHashBody = ContentHashRequest;
export type EvaluateRulesBody = EvaluateRulesRequest;
export type ValidateResponseBody = ValidateResponseRequest;
export type ValidateSchemaBody = ValidateSchemaRequest;
export type NextVersionBody = NextVersionRequest;
