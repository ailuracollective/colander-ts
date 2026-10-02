import type {
  CompiledForm,
  CompileRequest,
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
  VersionInfo,
} from "@ailura/colander";
import { Inject, Injectable } from "@nestjs/common";

import { COLANDER_CORE } from "./colander.constants.js";

/**
 * The only place the rest of the application touches the loaded core.
 *
 * Each method forwards its request unchanged and returns the core's result
 * unchanged: no reshaping, no caching, no business rules. Everything the core
 * computes stays in the core.
 */
@Injectable()
export class ColanderService {
  constructor(@Inject(COLANDER_CORE) private readonly core: LoadedCore) {}

  get abiVersion(): number {
    return this.core.abiVersion;
  }

  versionInfo(): VersionInfo {
    return this.core.versionInfo();
  }

  compile(request: CompileRequest): CompiledForm {
    return this.core.compile(request);
  }

  describeForm(request: DescribeFormRequest): DescribedForm {
    return this.core.describeForm(request);
  }

  contentHash(request: ContentHashRequest): string {
    return this.core.contentHash(request);
  }

  evaluateRules(request: EvaluateRulesRequest): RuleEvaluation {
    return this.core.evaluateRules(request);
  }

  validateResponse(request: ValidateResponseRequest): ResponseValidation {
    return this.core.validateResponse(request);
  }

  validateSchema(request: ValidateSchemaRequest): SchemaCheck {
    return this.core.validateSchema(request);
  }

  nextVersion(request?: NextVersionRequest): string {
    return this.core.nextVersion(request);
  }
}
