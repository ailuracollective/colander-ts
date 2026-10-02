import type {
  CompileRequest,
  CompiledForm,
  ContentHashRequest,
  CoreInfo,
  DescribeFormRequest,
  DescribedForm,
  EvaluateRulesRequest,
  NextVersionRequest,
  ResponseValidation,
  RuleEvaluation,
  SchemaCheck,
  ValidateResponseRequest,
  ValidateSchemaRequest,
} from "./types.js";

/** The complete request/response boundary for Colander operations. */
export interface ColanderTransport {
  readonly getCore: () => Promise<CoreInfo>;
  readonly compile: (request: CompileRequest) => Promise<CompiledForm>;
  readonly describeForm: (request: DescribeFormRequest) => Promise<DescribedForm>;
  readonly contentHash: (request: ContentHashRequest) => Promise<string>;
  readonly evaluateRules: (request: EvaluateRulesRequest) => Promise<RuleEvaluation>;
  readonly validateResponse: (request: ValidateResponseRequest) => Promise<ResponseValidation>;
  readonly validateSchema: (request: ValidateSchemaRequest) => Promise<SchemaCheck>;
  readonly nextVersion: (request?: NextVersionRequest) => Promise<string>;
}
