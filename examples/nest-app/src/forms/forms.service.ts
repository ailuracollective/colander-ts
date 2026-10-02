import type {
  CompiledForm,
  DescribedForm,
  ResponseValidation,
  RuleEvaluation,
  SchemaCheck,
  VersionInfo,
} from "@ailura/colander";
import { BadRequestException, Injectable } from "@nestjs/common";

import { ColanderService } from "../colander/colander.service.js";
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
 * Validates the HTTP request shape, then delegates to the core.
 *
 * A `…Json` field must arrive as text. It is never `JSON.stringify`d here: the
 * core hashes the bytes it receives, and re-serializing a parsed document
 * rewrites number literals and can reorder keys, which changes the content
 * hash.
 */
@Injectable()
export class FormsService {
  constructor(private readonly colander: ColanderService) {}

  get abiVersion(): number {
    return this.colander.abiVersion;
  }

  versionInfo(): VersionInfo {
    return this.colander.versionInfo();
  }

  compile(body: CompileBody | undefined): CompiledForm {
    const request = body ?? ({} as CompileBody);
    return this.colander.compile({
      ...request,
      formSchemaJson: requireJson(request.formSchemaJson, "formSchemaJson"),
      uiSchemaJson: optionalJson(request.uiSchemaJson, "uiSchemaJson"),
      rulesSchemaJson: optionalJson(request.rulesSchemaJson, "rulesSchemaJson"),
    });
  }

  describeForm(body: DescribeFormBody | undefined): DescribedForm {
    const request = body ?? ({} as DescribeFormBody);
    return this.colander.describeForm({
      ...request,
      formSchemaJson: requireJson(request.formSchemaJson, "formSchemaJson"),
      uiSchemaJson: optionalJson(request.uiSchemaJson, "uiSchemaJson"),
      rulesSchemaJson: optionalJson(request.rulesSchemaJson, "rulesSchemaJson"),
    });
  }

  contentHash(body: ContentHashBody | undefined): string {
    const request = body ?? ({} as ContentHashBody);
    return this.colander.contentHash({
      ...request,
      formSchemaJson: requireJson(request.formSchemaJson, "formSchemaJson"),
      uiSchemaJson: optionalJson(request.uiSchemaJson, "uiSchemaJson"),
      rulesSchemaJson: optionalJson(request.rulesSchemaJson, "rulesSchemaJson"),
    });
  }

  evaluateRules(body: EvaluateRulesBody | undefined): RuleEvaluation {
    const request = body ?? ({} as EvaluateRulesBody);
    return this.colander.evaluateRules({
      ...request,
      formSchemaJson: requireJson(request.formSchemaJson, "formSchemaJson"),
      rulesSchemaJson: requireJson(request.rulesSchemaJson, "rulesSchemaJson"),
      uiSchemaJson: optionalJson(request.uiSchemaJson, "uiSchemaJson"),
    });
  }

  validateResponse(body: ValidateResponseBody | undefined): ResponseValidation {
    const request = body ?? ({} as ValidateResponseBody);
    return this.colander.validateResponse({
      ...request,
      formSchemaJson: requireJson(request.formSchemaJson, "formSchemaJson"),
      answersJson: requireJson(request.answersJson, "answersJson"),
      uiSchemaJson: optionalJson(request.uiSchemaJson, "uiSchemaJson"),
      rulesSchemaJson: optionalJson(request.rulesSchemaJson, "rulesSchemaJson"),
    });
  }

  validateSchema(body: ValidateSchemaBody | undefined): SchemaCheck {
    const request = body ?? ({} as ValidateSchemaBody);
    return this.colander.validateSchema({
      ...request,
      formSchemaJson: optionalJson(request.formSchemaJson, "formSchemaJson"),
      uiSchemaJson: optionalJson(request.uiSchemaJson, "uiSchemaJson"),
      rulesSchemaJson: optionalJson(request.rulesSchemaJson, "rulesSchemaJson"),
      workflowSchemaJson: optionalJson(request.workflowSchemaJson, "workflowSchemaJson"),
      schemaJson: optionalJson(request.schemaJson, "schemaJson"),
      instanceJson: optionalJson(request.instanceJson, "instanceJson"),
    });
  }

  nextVersion(body: NextVersionBody | undefined): string {
    return this.colander.nextVersion(body);
  }
}

function requireJson(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new BadRequestException(`'${field}' is required and must be a string of JSON text.`);
  }
  return value;
}

function optionalJson(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`'${field}' must be a string of JSON text.`);
  }
  return value;
}
