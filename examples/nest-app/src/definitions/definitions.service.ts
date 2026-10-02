import { ColanderError } from "@ailura/colander";
import { BadRequestException, HttpException, HttpStatus, Injectable } from "@nestjs/common";

import { ColanderService } from "../colander/colander.service.js";
import {
  FormsRepository,
  FormsRepositoryError,
  type FormDefinition,
  type FormVersion,
  type FormVersionDocuments,
  type UpdateDefinitionInput,
} from "../db/forms.repository.js";
import type {
  CreateDefinitionBody,
  DefinitionDetail,
  DefinitionSummary,
  LiveSchemaCheck,
  UpdateDefinitionBody,
  VersionDetail,
  VersionDocumentsBody,
  VersionSummary,
} from "./definitions.types.js";

/**
 * The definitions resource, over `FormsRepository` and the core.
 *
 * Two rules shape every method here:
 *
 * **A draft is stored as received, valid or not.** Saving never asks the core
 * for permission — an editor that could not save a half-built form would be
 * useless — so a draft write goes straight to the repository and the core is
 * not consulted. Publication is the gate.
 *
 * **Publication is validated by the core first.** `publish` runs the document
 * through the core and returns 400 with the core's own message when the core
 * says no; only an accepted document reaches `publishVersion`, together with
 * the content hash computed from the same document text.
 */

/**
 * Every `FormsRepositoryError` code, and the status it answers with. The map is
 * total on purpose: a new code fails the build here instead of falling through
 * to a 500 at runtime.
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
export class DefinitionsService {
  constructor(
    private readonly repository: FormsRepository,
    private readonly colander: ColanderService,
  ) {}

  // -- definitions ---------------------------------------------------------

  async list(): Promise<DefinitionSummary[]> {
    return this.guard(async () => {
      const definitions = await this.repository.listDefinitions();
      return Promise.all(definitions.map((definition) => this.summarize(definition)));
    });
  }

  async create(body: CreateDefinitionBody | undefined): Promise<FormDefinition> {
    const request = body ?? {};
    const name = requireName(request.name);
    const description = optionalText(request.description, "description") ?? "";
    return this.guard(() => this.repository.createDefinition({ name, description }));
  }

  async get(id: string): Promise<DefinitionDetail> {
    return this.guard(async () => {
      const definition = await this.repository.getDefinition(id);
      if (definition === null) {
        throw new FormsRepositoryError("definition_not_found", `No form definition with id ${id}.`);
      }
      const versions = await this.repository.listVersions(id);
      return { definition, versions: versions.map(summarizeVersion) };
    });
  }

  async update(id: string, body: UpdateDefinitionBody | undefined): Promise<FormDefinition> {
    const request = body ?? {};
    const patch: UpdateDefinitionInput = {
      ...(request.name === undefined ? {} : { name: requireName(request.name) }),
      ...(request.description === undefined
        ? {}
        : { description: optionalText(request.description, "description") ?? "" }),
    };
    return this.guard(async () => {
      // `updateDefinition` updates zero rows for an unknown id and only notices
      // when it reads the row back, so the 404 is raised either way; checking
      // first keeps the message the same for both paths.
      await this.requireDefinition(id);
      return this.repository.updateDefinition(id, patch);
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.guard(async () => {
      await this.requireDefinition(id);
      // Cascades to versions and, through them, to responses, entirely in SQL.
      return this.repository.deleteDefinition(id);
    });
  }

  // -- versions ------------------------------------------------------------

  async createDraft(id: string, body: VersionDocumentsBody | undefined): Promise<FormVersion> {
    const documents = readDocuments(body, { requireFormSchema: true });
    return this.guard(async () => {
      await this.requireDefinition(id);
      // No core call: a draft is a work in progress and is stored as received.
      return this.repository.createDraft(id, fullDocuments(documents));
    });
  }

  async listVersions(id: string): Promise<VersionSummary[]> {
    return this.guard(async () => {
      await this.requireDefinition(id);
      return (await this.repository.listVersions(id)).map(summarizeVersion);
    });
  }

  async getVersion(id: string, versionId: string): Promise<VersionDetail> {
    return this.guard(async () => {
      const version = await this.requireVersion(id, versionId);
      return { version, schemaCheck: this.schemaCheck(version) };
    });
  }

  async updateDraft(
    id: string,
    versionId: string,
    body: VersionDocumentsBody | undefined,
  ): Promise<FormVersion> {
    // Every field is optional on a PATCH: changing the ui schema must not
    // require resending the form schema.
    const patch = readDocuments(body);
    return this.guard(async () => {
      await this.requireVersion(id, versionId);
      // A published version raises `version_immutable` / `version_not_draft`
      // here, which is a 409. Storing without asking the core is the point.
      return this.repository.updateDraft(versionId, patch);
    });
  }

  async deleteDraft(id: string, versionId: string): Promise<boolean> {
    return this.guard(async () => {
      await this.requireVersion(id, versionId);
      return this.repository.deleteDraft(versionId);
    });
  }

  /**
   * The gate. The core answers whether the stored document is publishable; a
   * refusal is a 400 carrying the core's own message, and the version stays
   * exactly the draft it was. Acceptance is followed by the content hash
   * computed from the same document text, and only then by the write.
   */
  async publish(id: string, versionId: string): Promise<FormVersion> {
    return this.guard(async () => {
      const version = await this.requireVersion(id, versionId);
      if (version.status !== "draft") {
        // The repository would say the same thing on the write; asking first
        // keeps a published version from being run through the core at all.
        throw new FormsRepositoryError(
          "version_already_published",
          `Version ${versionId} is already published.`,
        );
      }
      const check = this.check(version);
      if (!check.valid) {
        throw new BadRequestException({ code: check.code, message: check.message });
      }
      const contentHash = this.colander.contentHash(hashRequest(version));
      return this.repository.publishVersion(versionId, contentHash);
    });
  }

  /**
   * Clones one specific version into a new draft. The source is only read, so it
   * is byte-identical afterwards; a published source is the normal case, which
   * is the only way to change a published form.
   */
  async clone(
    id: string,
    versionId: string,
    body: VersionDocumentsBody | undefined,
  ): Promise<FormVersion> {
    return this.guard(async () => {
      const source = await this.requireVersion(id, versionId);
      // The repository's `cloneLatestAsDraft` would ignore `:versionId` and copy
      // whatever the highest version happens to be, so the clone is assembled
      // here from the requested version instead. Overrides let the editor clone
      // and change in one call; without them the documents are copied verbatim.
      const overrides = readDocuments(body);
      const documents: FormVersionDocuments = {
        formSchemaJson: overrides.formSchemaJson ?? source.formSchemaJson,
        uiSchemaJson: overrides.uiSchemaJson ?? source.uiSchemaJson,
        rulesSchemaJson: overrides.rulesSchemaJson ?? source.rulesSchemaJson,
        componentsJson: overrides.componentsJson ?? source.componentsJson,
      };
      return this.repository.createDraft(id, documents);
    });
  }

  async published(id: string): Promise<FormVersion> {
    return this.guard(async () => {
      await this.requireDefinition(id);
      const version = await this.repository.getLatestPublishedVersion(id);
      if (version === null) {
        throw new FormsRepositoryError(
          "no_published_version",
          `Form definition ${id} has no published version.`,
        );
      }
      return version;
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

  private async requireDefinition(id: string): Promise<FormDefinition> {
    const definition = await this.repository.getDefinition(id);
    if (definition === null) {
      throw new FormsRepositoryError("definition_not_found", `No form definition with id ${id}.`);
    }
    return definition;
  }

  /**
   * Reads a version and refuses one that belongs to another definition: a
   * version id is only meaningful under its own form, and answering with the
   * other form's row would leak it.
   */
  private async requireVersion(id: string, versionId: string): Promise<FormVersion> {
    await this.requireDefinition(id);
    const version = await this.repository.getVersion(versionId);
    if (version === null || version.formId !== id) {
      throw new FormsRepositoryError("version_not_found", `No form version with id ${versionId}.`);
    }
    return version;
  }

  private async summarize(definition: FormDefinition): Promise<DefinitionSummary> {
    const versions = await this.repository.listVersions(definition.id);
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      versionCount: versions.length,
      isPublished: versions.some((version) => version.status === "published"),
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
    };
  }

  /**
   * The live dry-run behind `schemaCheck` on a version read.
   *
   * `ColanderService.validateSchema` is deliberately not used: colander ships
   * no JSON Schemas, and the core answers `valid: false "schemas is required"`
   * to every document that arrives without one, so it cannot tell a good
   * document from a bad one here. `compile` is the core's own "is this a
   * publishable form" question, and it reports invalidity as a
   * `ColanderError` of kind `validation` rather than as a result, so the
   * dry-run catches that and turns it back into a result.
   */
  private schemaCheck(version: FormVersion): LiveSchemaCheck {
    return this.check(version);
  }

  private check(version: FormVersion): LiveSchemaCheck {
    try {
      this.colander.compile({
        formSchemaJson: version.formSchemaJson,
        ...(version.uiSchemaJson === null ? {} : { uiSchemaJson: version.uiSchemaJson }),
        ...(version.rulesSchemaJson === null ? {} : { rulesSchemaJson: version.rulesSchemaJson }),
      });
      return { valid: true, contentHash: this.colander.contentHash(hashRequest(version)) };
    } catch (error) {
      if (error instanceof ColanderError && error.kind === "validation") {
        return { valid: false, code: error.code, message: error.message };
      }
      throw error;
    }
  }
}

function summarizeVersion(version: FormVersion) {
  return {
    id: version.id,
    formId: version.formId,
    version: version.version,
    status: version.status,
    contentHash: version.contentHash,
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
  } satisfies VersionSummary;
}

/** The core hashes the form schema and the two documents that change it. */
function hashRequest(version: FormVersion): {
  formSchemaJson: string;
  uiSchemaJson?: string;
  rulesSchemaJson?: string;
} {
  return {
    formSchemaJson: version.formSchemaJson,
    ...(version.uiSchemaJson === null ? {} : { uiSchemaJson: version.uiSchemaJson }),
    ...(version.rulesSchemaJson === null ? {} : { rulesSchemaJson: version.rulesSchemaJson }),
  };
}

/**
 * Reads the document fields off a body, keeping the text exactly as it arrived.
 * `required` marks the one document a draft cannot be created without; the
 * others are optional. A field that is present must be a string of JSON text,
 * the same rule the computation routes enforce, for the same reason.
 */
function readDocuments(
  body: VersionDocumentsBody | undefined,
  options: { requireFormSchema?: boolean } = {},
): Partial<FormVersionDocuments> {
  const request = body ?? {};
  const formSchemaJson = documentText(request.formSchemaJson, "formSchemaJson");
  if (formSchemaJson === undefined && options.requireFormSchema === true) {
    throw new BadRequestException("'formSchemaJson' is required and must be a string of JSON text.");
  }
  const uiSchemaJson = documentText(request.uiSchemaJson, "uiSchemaJson");
  const rulesSchemaJson = documentText(request.rulesSchemaJson, "rulesSchemaJson");
  const componentsJson = documentText(request.componentsJson, "componentsJson");
  return {
    ...(formSchemaJson === undefined ? {} : { formSchemaJson }),
    ...(uiSchemaJson === undefined ? {} : { uiSchemaJson }),
    ...(rulesSchemaJson === undefined ? {} : { rulesSchemaJson }),
    ...(componentsJson === undefined ? {} : { componentsJson }),
  };
}

/** The repository's own document shape, with the one required field enforced. */
function fullDocuments(documents: Partial<FormVersionDocuments>): FormVersionDocuments {
  if (documents.formSchemaJson === undefined) {
    throw new BadRequestException("'formSchemaJson' is required and must be a string of JSON text.");
  }
  return {
    formSchemaJson: documents.formSchemaJson,
    ...(documents.uiSchemaJson === undefined ? {} : { uiSchemaJson: documents.uiSchemaJson }),
    ...(documents.rulesSchemaJson === undefined ? {} : { rulesSchemaJson: documents.rulesSchemaJson }),
    ...(documents.componentsJson === undefined ? {} : { componentsJson: documents.componentsJson }),
  };
}

/** A document field is JSON text or nothing; a parsed document is refused. */
function documentText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`'${field}' must be a string of JSON text.`);
  }
  return value;
}

function requireName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestException("'name' is required and must be a non-empty string.");
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`'${field}' must be a string.`);
  }
  return value;
}
