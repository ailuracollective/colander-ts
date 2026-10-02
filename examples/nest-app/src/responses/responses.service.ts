import { ColanderError } from "@ailura/colander";
import type { ResponseValidation, ValidationMode } from "@ailura/colander";
import { BadRequestException, HttpException, HttpStatus, Injectable } from "@nestjs/common";

import { ColanderService } from "../colander/colander.service.js";
import {
  FormsRepository,
  FormsRepositoryError,
  type FormResponse,
  type FormVersion,
} from "../db/forms.repository.js";
import type { SubmitResponseBody } from "./responses.types.js";

/**
 * The responses resource, over `FormsRepository` and the core.
 *
 * One rule shapes every write here:
 *
 * **A response is validated by the core before it is stored, and it is stored
 * either way.** An invalid answer is a fact about the world, not a request the
 * server may refuse: a form that silently dropped what people typed would be
 * worse than one that recorded a mistake. So the row carries the answers
 * exactly as they arrived, the core's own `ResponseValidation` as
 * `validationJson`, and `isValid` read off that result. A `201` here means
 * "recorded", never "accepted".
 *
 * What *is* refused is a target the repository refuses: a version that is not
 * published, and a version that belongs to another form. Both checks stay in
 * the repository, where the rules already live.
 */

/**
 * Every `FormsRepositoryError` code, and the status it answers with. The map is
 * total on purpose: a new code fails the build here instead of falling through
 * to a 500 at runtime. It is the same map the definitions resource uses, and
 * the two have to agree — `response_version_not_published` is a 409 in both.
 */
const STATUS_BY_CODE: Record<FormsRepositoryError["code"], number> = {
  definition_not_found: HttpStatus.NOT_FOUND,
  version_not_found: HttpStatus.NOT_FOUND,
  no_published_version: HttpStatus.NOT_FOUND,
  version_not_draft: HttpStatus.CONFLICT,
  version_already_published: HttpStatus.CONFLICT,
  version_immutable: HttpStatus.CONFLICT,
  duplicate_version: HttpStatus.CONFLICT,
  response_version_not_published: HttpStatus.CONFLICT,
  response_version_mismatch: HttpStatus.CONFLICT,
};

function repositoryFailure(error: unknown): unknown {
  if (error instanceof FormsRepositoryError) {
    return new HttpException({ code: error.code, message: error.message }, STATUS_BY_CODE[error.code]);
  }
  return error;
}

@Injectable()
export class ResponsesService {
  constructor(
    private readonly repository: FormsRepository,
    private readonly colander: ColanderService,
  ) {}

  // -- responses -----------------------------------------------------------

  /**
   * Records an answer set against a published version of its own form.
   *
   * The order is the rule: read the target version, ask the core what it makes
   * of those answers, and only then write. A version the repository will not
   * accept is refused by the repository itself, so the conflict is the
   * repository's own code rather than a second derivation of it here.
   */
  async submit(body: SubmitResponseBody | undefined): Promise<FormResponse> {
    const request = body ?? {};
    const formId = requireFormId(request.formId);
    const answersJson = requireJson(request.answersJson, "answersJson");
    return this.guard(async () => {
      const version = await this.targetVersion(formId, optionalId(request.versionId, "versionId"));
      const validation = this.validate(version, answersJson, request.mode);
      return this.repository.submitResponse({
        formId,
        versionId: version.id,
        answersJson,
        // The core's result verbatim, so a later read can show the errors the
        // core reported rather than a second opinion computed from the answers.
        validationJson: JSON.stringify(validation),
        isValid: validation.isValid,
      });
    });
  }

  /**
   * The answers of one form, newest first. The form is named by a query
   * parameter rather than a path segment because the two paths this controller
   * owns are `/` and `/:id`; a `/responses/:formId` would collide with it.
   *
   * An unknown form and a form with no responses are both an empty list: the
   * endpoint answers about the responses it finds, not about the definition.
   */
  async list(formId: unknown): Promise<FormResponse[]> {
    return this.guard(() => this.repository.listResponses(requireFormId(formId)));
  }

  async get(id: string): Promise<FormResponse> {
    return this.guard(async () => {
      const response = await this.repository.getResponse(id);
      if (response === null) {
        // The repository reads a missing row as `null` rather than as a typed
        // error, so this is the one code on this resource it does not own.
        throw new HttpException(
          { code: "response_not_found", message: `No response with id ${id}.` },
          HttpStatus.NOT_FOUND,
        );
      }
      return response;
    });
  }

  // -- internals -----------------------------------------------------------

  /** Runs repository work, translating its typed errors into HTTP answers. */
  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw repositoryFailure(error);
    }
  }

  /**
   * The version an answer set is measured against.
   *
   * Without a `versionId` this is the form's published version, read through
   * the repository's own query — the same one the definitions resource serves
   * `GET /definitions/:id/published` from — so "the form has nothing published"
   * is a 404 (`no_published_version`) rather than a conflict. With a
   * `versionId` the named row is read as it stands; whether it may accept
   * responses at all is not decided here.
   */
  private async targetVersion(formId: string, versionId: string | undefined): Promise<FormVersion> {
    if (versionId !== undefined) {
      const version = await this.repository.getVersion(versionId);
      if (version === null) {
        // Same code and status the repository would have produced on the
        // write; raising it here keeps an unknown version from being run
        // through the core at all.
        throw new FormsRepositoryError("version_not_found", `No form version with id ${versionId}.`);
      }
      return version;
    }
    const published = await this.repository.getLatestPublishedVersion(formId);
    if (published === null) {
      throw new FormsRepositoryError(
        "no_published_version",
        `Form definition ${formId} has no published version.`,
      );
    }
    return published;
  }

  /**
   * The core's own answer, over the stored document text and the answers as
   * they arrived.
   *
   * A rejected answer is a result, not an exception, so nothing here treats
   * `isValid: false` as a failure. The core only throws when the request
   * itself is unusable — answers that are not JSON text, say — and that is a
   * 400 carrying the core's own code, the same mapping the definitions
   * resource applies to a refused document.
   */
  private validate(
    version: FormVersion,
    answersJson: string,
    mode: ValidationMode | undefined,
  ): ResponseValidation {
    try {
      return this.colander.validateResponse({
        formSchemaJson: version.formSchemaJson,
        answersJson,
        // Absent stays absent, so the core applies its own `"Draft"` default
        // rather than this service inventing one.
        ...(mode === undefined ? {} : { mode }),
        ...(version.uiSchemaJson === null ? {} : { uiSchemaJson: version.uiSchemaJson }),
        ...(version.rulesSchemaJson === null ? {} : { rulesSchemaJson: version.rulesSchemaJson }),
      });
    } catch (error) {
      if (error instanceof ColanderError && error.kind === "validation") {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }
  }
}

function requireFormId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestException("'formId' is required and must be a non-empty string.");
  }
  return value;
}

/** An answers field is JSON text; a parsed answer set is refused. */
function requireJson(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new BadRequestException(`'${field}' is required and must be a string of JSON text.`);
  }
  return value;
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestException(`'${field}' must be a non-empty string.`);
  }
  return value;
}
