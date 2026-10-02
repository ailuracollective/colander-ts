import type {
  CompiledForm,
  DescribedForm,
  ResponseValidation,
  RuleEvaluation,
  SchemaCheck,
  VersionInfo,
} from "@ailura/colander";
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { FormsService } from "./forms.service.js";
import type {
  CompileBody,
  ContentHashBody,
  DescribeFormBody,
  EvaluateRulesBody,
  NextVersionBody,
  ValidateResponseBody,
  ValidateSchemaBody,
} from "./forms.types.js";

/**
 * Every route is a computation, so every route answers 200 rather than Nest's
 * default 201 for POST.
 */
@Controller("forms")
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get("core")
  @HttpCode(HttpStatus.OK)
  core(): { abiVersion: number; versionInfo: VersionInfo } {
    return {
      abiVersion: this.forms.abiVersion,
      versionInfo: this.forms.versionInfo(),
    };
  }

  @Post("compile")
  @HttpCode(HttpStatus.OK)
  compile(@Body() body: CompileBody): CompiledForm {
    return this.forms.compile(body);
  }

  @Post("describe-form")
  @HttpCode(HttpStatus.OK)
  describeForm(@Body() body: DescribeFormBody): DescribedForm {
    return this.forms.describeForm(body);
  }

  @Post("content-hash")
  @HttpCode(HttpStatus.OK)
  contentHash(@Body() body: ContentHashBody): string {
    return this.forms.contentHash(body);
  }

  @Post("evaluate-rules")
  @HttpCode(HttpStatus.OK)
  evaluateRules(@Body() body: EvaluateRulesBody): RuleEvaluation {
    return this.forms.evaluateRules(body);
  }

  @Post("validate-response")
  @HttpCode(HttpStatus.OK)
  validateResponse(@Body() body: ValidateResponseBody): ResponseValidation {
    return this.forms.validateResponse(body);
  }

  @Post("validate-schema")
  @HttpCode(HttpStatus.OK)
  validateSchema(@Body() body: ValidateSchemaBody): SchemaCheck {
    return this.forms.validateSchema(body);
  }

  @Post("next-version")
  @HttpCode(HttpStatus.OK)
  nextVersion(@Body() body: NextVersionBody): string {
    return this.forms.nextVersion(body);
  }
}
