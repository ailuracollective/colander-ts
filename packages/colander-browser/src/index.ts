export { createWebColander } from "./client.js";
export type {
  WebColanderClient,
  WebColanderCoreInfo,
  WebColanderLoader,
  WebColanderOptions,
} from "./client.js";
export { ColanderWebError } from "./errors.js";
export type { ColanderWebErrorKind, ColanderWebErrorOptions } from "./errors.js";

export {
  ColanderTransportError,
  isColanderSourceErrorKind,
  isColanderTransportErrorKind,
  toColanderTransportError,
} from "@ailura/colander-client";
export type {
  ColanderAnyErrorKind,
  ColanderFailure,
  ColanderFailureBody,
  ColanderSourceErrorKind,
  ColanderTransportErrorKind,
  ColanderTransportErrorOptions,
} from "@ailura/colander-client";

export { COLANDER_ABI_VERSION, ColanderError, loadBundledWasm } from "@ailura/colander";
export { COLANDER_MAX_REQUEST_BYTES } from "@ailura/colander";
export type {
  ColanderErrorKind,
  ColanderExports,
  CompileRequest,
  CompiledForm,
  ComponentReference,
  ContentHashRequest,
  DescribeFormRequest,
  DescribedField,
  DescribedForm,
  EvaluateRulesRequest,
  FieldType,
  LoadedCore,
  NextVersionRequest,
  ResponseError,
  ResponseValidation,
  RuleEvaluation,
  SchemaCheck,
  SchemaKind,
  SchemaResult,
  ValidateResponseRequest,
  ValidateSchemaRequest,
  ValidationError,
  ValidationMode,
  VersionBump,
  VersionInfo,
  WasmAssetLoaderOptions,
  WasmRuntime,
  WasmSource,
} from "@ailura/colander";
