import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import type { ColanderDatabase } from "./client.js";
import { formDefinitions, formVersions, responses, type FormVersionStatus } from "./schema.js";

/**
 * The persistence API for definitions, versions and responses.
 *
 * A plain class, constructed with a database handle and wired into Nest in T2.
 * It has no Nest decorators on purpose: the rules it encodes — version
 * numbering, draft-only mutation, published-only responses — are persistence
 * rules, not HTTP rules, and they should be testable without a Nest container.
 *
 * Every method returns a plain typed object. Drizzle rows never escape this
 * file, so a change in the column layout cannot leak into the transport layer.
 */

/** Every failure this repository raises carries one of these codes. */
export type FormsRepositoryErrorCode =
  | "definition_not_found"
  | "version_not_found"
  | "version_not_draft"
  | "version_already_published"
  | "version_immutable"
  | "duplicate_version"
  | "response_version_not_published"
  | "response_version_mismatch"
  | "no_published_version";

export class FormsRepositoryError extends Error {
  constructor(
    readonly code: FormsRepositoryErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "FormsRepositoryError";
  }
}

export interface FormDefinition {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface FormVersion {
  id: string;
  formId: string;
  version: number;
  status: FormVersionStatus;
  formSchemaJson: string;
  uiSchemaJson: string | null;
  rulesSchemaJson: string | null;
  componentsJson: string | null;
  contentHash: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface FormResponse {
  id: string;
  formId: string;
  versionId: string;
  answersJson: string;
  validationJson: string | null;
  isValid: boolean;
  createdAt: string;
}

/** The documents a version is made of, as the exact JSON text that was compiled. */
export interface FormVersionDocuments {
  formSchemaJson: string;
  uiSchemaJson?: string | null;
  rulesSchemaJson?: string | null;
  componentsJson?: string | null;
}

export interface CreateDefinitionInput {
  name: string;
  description?: string;
}

export interface UpdateDefinitionInput {
  name?: string;
  description?: string;
}

export interface SubmitResponseInput {
  formId: string;
  versionId: string;
  answersJson: string;
  validationJson?: string | null;
  isValid: boolean;
}

/** ISO 8601 UTC. The only timestamp format written. */
function now(): string {
  return new Date().toISOString();
}

/**
 * Drizzle wraps driver errors in a `DrizzleQueryError` whose own message is only
 * `Failed query: ...`; the SQLite message and code live on the `cause` chain.
 * Both levels are inspected so a trigger or a unique violation is recognised
 * wherever it is raised.
 */
function errorChain(error: unknown): Array<{ message: string; code: unknown }> {
  const chain: Array<{ message: string; code: unknown }> = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 10; depth += 1) {
    chain.push({ message: current.message, code: (current as { code?: unknown }).code });
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function isUniqueViolation(error: unknown): boolean {
  return errorChain(error).some(
    ({ message, code }) =>
      message.includes("UNIQUE constraint failed") ||
      (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT") && code.includes("UNIQUE")),
  );
}

/** The published-version trigger aborting the statement. */
function isImmutabilityViolation(error: unknown): boolean {
  return errorChain(error).some(({ message }) => message.includes("published versions are immutable"));
}

export class FormsRepository {
  constructor(private readonly db: ColanderDatabase) {}

  // -- definitions ---------------------------------------------------------

  async createDefinition(input: CreateDefinitionInput): Promise<FormDefinition> {
    const timestamp = now();
    const definition: FormDefinition = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db.insert(formDefinitions).values(definition).run();
    return definition;
  }

  async getDefinition(id: string): Promise<FormDefinition | null> {
    const row = await this.db.select().from(formDefinitions).where(eq(formDefinitions.id, id)).get();
    return row ?? null;
  }

  async listDefinitions(): Promise<FormDefinition[]> {
    return this.db
      .select()
      .from(formDefinitions)
      .orderBy(desc(formDefinitions.updatedAt), desc(formDefinitions.createdAt))
      .all();
  }

  /** Partial update: only the provided fields change, and `updated_at` moves. */
  async updateDefinition(id: string, input: UpdateDefinitionInput): Promise<FormDefinition> {
    const patch = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      updatedAt: now(),
    };
    await this.db.update(formDefinitions).set(patch).where(eq(formDefinitions.id, id)).run();
    const definition = await this.getDefinition(id);
    if (definition === null) {
      throw new FormsRepositoryError("definition_not_found", `No form definition with id ${id}.`);
    }
    return definition;
  }

  /**
   * Deletes a definition, cascading to its versions and, through them, to their
   * responses. Published versions go with it, and only with it: the delete
   * trigger lets the cascade through because the parent row is already gone,
   * and refuses any delete of a published version whose definition is still
   * there. No flag, no transaction, nothing to keep in sync.
   */
  async deleteDefinition(id: string): Promise<boolean> {
    const result = await this.db.delete(formDefinitions).where(eq(formDefinitions.id, id)).run();
    return result.rowsAffected > 0;
  }

  // -- versions ------------------------------------------------------------

  /**
   * Creates the next draft for a form.
   *
   * The version number is read and inserted inside one transaction, and
   * `UNIQUE(form_id, version)` is what actually makes two concurrent drafts
   * impossible: the loser gets a unique violation, surfaced as
   * `duplicate_version`, instead of a second draft sharing a version number.
   */
  async createDraft(formId: string, documents: FormVersionDocuments): Promise<FormVersion> {
    const timestamp = now();
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ max: sql<number | null>`max(${formVersions.version})` })
        .from(formVersions)
        .where(eq(formVersions.formId, formId))
        .get();
      const nextVersion = (existing?.max ?? 0) + 1;
      const version: FormVersion = {
        id: randomUUID(),
        formId,
        version: nextVersion,
        status: "draft",
        formSchemaJson: documents.formSchemaJson,
        uiSchemaJson: documents.uiSchemaJson ?? null,
        rulesSchemaJson: documents.rulesSchemaJson ?? null,
        componentsJson: documents.componentsJson ?? null,
        contentHash: null,
        createdAt: timestamp,
        publishedAt: null,
      };
      try {
        await tx.insert(formVersions).values(version).run();
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new FormsRepositoryError(
            "duplicate_version",
            `Version ${nextVersion} already exists for form ${formId}.`,
            { cause: error },
          );
        }
        throw error;
      }
      return version;
    });
  }

  async getVersion(versionId: string): Promise<FormVersion | null> {
    return (await this.db.select().from(formVersions).where(eq(formVersions.id, versionId)).get()) ?? null;
  }

  /** The highest version number, published or not. */
  async getLatestVersion(formId: string): Promise<FormVersion | null> {
    return (
      (await this.db
        .select()
        .from(formVersions)
        .where(eq(formVersions.formId, formId))
        .orderBy(desc(formVersions.version))
        .limit(1)
        .get()) ?? null
    );
  }

  async getLatestPublishedVersion(formId: string): Promise<FormVersion | null> {
    return (
      (await this.db
        .select()
        .from(formVersions)
        .where(and(eq(formVersions.formId, formId), eq(formVersions.status, "published")))
        .orderBy(desc(formVersions.version))
        .limit(1)
        .get()) ?? null
    );
  }

  async listVersions(formId: string): Promise<FormVersion[]> {
    return this.db
      .select()
      .from(formVersions)
      .where(eq(formVersions.formId, formId))
      .orderBy(desc(formVersions.version))
      .all();
  }

  /**
   * Updates a draft's documents. The `status = 'draft'` predicate is the
   * application half of the immutability rule; the trigger in `0000_init.sql`
   * is the half that cannot be bypassed. Exactly one row must change.
   */
  async updateDraft(versionId: string, documents: Partial<FormVersionDocuments>): Promise<FormVersion> {
    const patch = {
      ...(documents.formSchemaJson === undefined ? {} : { formSchemaJson: documents.formSchemaJson }),
      ...(documents.uiSchemaJson === undefined ? {} : { uiSchemaJson: documents.uiSchemaJson }),
      ...(documents.rulesSchemaJson === undefined ? {} : { rulesSchemaJson: documents.rulesSchemaJson }),
      ...(documents.componentsJson === undefined ? {} : { componentsJson: documents.componentsJson }),
      createdAt: now(),
    };
    let result;
    try {
      result = await this.db
        .update(formVersions)
        .set(patch)
        .where(and(eq(formVersions.id, versionId), eq(formVersions.status, "draft")))
        .run();
    } catch (error) {
      if (isImmutabilityViolation(error)) {
        throw new FormsRepositoryError("version_immutable", `Version ${versionId} is published.`, {
          cause: error,
        });
      }
      throw error;
    }
    if (result.rowsAffected !== 1) {
      const version = await this.getVersion(versionId);
      if (version === null) {
        throw new FormsRepositoryError("version_not_found", `No form version with id ${versionId}.`);
      }
      throw new FormsRepositoryError(
        "version_not_draft",
        `Version ${versionId} is ${version.status}; only drafts can be updated.`,
      );
    }
    const updated = await this.getVersion(versionId);
    if (updated === null) {
      throw new FormsRepositoryError("version_not_found", `No form version with id ${versionId}.`);
    }
    return updated;
  }

  /**
   * Publishes a draft: status flips to `published` and `published_at` is set.
   * An already published version is refused with a typed error rather than a
   * raw driver error, even though the trigger would abort the statement anyway.
   */
  async publishVersion(versionId: string, contentHash: string): Promise<FormVersion> {
    const version = await this.getVersion(versionId);
    if (version === null) {
      throw new FormsRepositoryError("version_not_found", `No form version with id ${versionId}.`);
    }
    if (version.status !== "draft") {
      throw new FormsRepositoryError(
        "version_already_published",
        `Version ${versionId} is already published.`,
      );
    }
    let result;
    try {
      result = await this.db
        .update(formVersions)
        .set({ status: "published", contentHash, publishedAt: now() })
        .where(and(eq(formVersions.id, versionId), eq(formVersions.status, "draft")))
        .run();
    } catch (error) {
      if (isImmutabilityViolation(error)) {
        throw new FormsRepositoryError(
          "version_already_published",
          `Version ${versionId} is published and cannot be republished.`,
          { cause: error },
        );
      }
      throw error;
    }
    if (result.rowsAffected !== 1) {
      throw new FormsRepositoryError(
        "version_already_published",
        `Version ${versionId} is no longer a draft.`,
      );
    }
    const published = await this.getVersion(versionId);
    if (published === null) {
      throw new FormsRepositoryError("version_not_found", `No form version with id ${versionId}.`);
    }
    return published;
  }

  /**
   * The only way to change a published form: clone the latest version into a
   * fresh editable draft. The published row is not read for update at all, so
   * it stays byte-identical.
   */
  async cloneLatestAsDraft(formId: string, documents?: Partial<FormVersionDocuments>): Promise<FormVersion> {
    const latest = await this.getLatestVersion(formId);
    if (latest === null) {
      throw new FormsRepositoryError("no_published_version", `Form ${formId} has no version to clone.`);
    }
    return this.createDraft(formId, {
      formSchemaJson: documents?.formSchemaJson ?? latest.formSchemaJson,
      uiSchemaJson: documents?.uiSchemaJson === undefined ? latest.uiSchemaJson : documents.uiSchemaJson,
      rulesSchemaJson:
        documents?.rulesSchemaJson === undefined ? latest.rulesSchemaJson : documents.rulesSchemaJson,
      componentsJson:
        documents?.componentsJson === undefined ? latest.componentsJson : documents.componentsJson,
    });
  }

  /** Deletes a draft. A published version is refused by the trigger. */
  async deleteDraft(versionId: string): Promise<boolean> {
    const version = await this.getVersion(versionId);
    if (version === null) {
      throw new FormsRepositoryError("version_not_found", `No form version with id ${versionId}.`);
    }
    if (version.status !== "draft") {
      throw new FormsRepositoryError(
        "version_immutable",
        `Version ${versionId} is published and cannot be deleted.`,
      );
    }
    await this.db.delete(formVersions).where(eq(formVersions.id, versionId)).run();
    return true;
  }

  // -- responses -----------------------------------------------------------

  /** A response is only accepted against a published version of its own form. */
  async submitResponse(input: SubmitResponseInput): Promise<FormResponse> {
    const version = await this.getVersion(input.versionId);
    if (version === null) {
      throw new FormsRepositoryError("version_not_found", `No form version with id ${input.versionId}.`);
    }
    if (version.status !== "published") {
      throw new FormsRepositoryError(
        "response_version_not_published",
        `Version ${input.versionId} is a draft; responses require a published version.`,
      );
    }
    if (version.formId !== input.formId) {
      throw new FormsRepositoryError(
        "response_version_mismatch",
        `Version ${input.versionId} belongs to form ${version.formId}, not ${input.formId}.`,
      );
    }
    const response: FormResponse = {
      id: randomUUID(),
      formId: input.formId,
      versionId: input.versionId,
      answersJson: input.answersJson,
      validationJson: input.validationJson ?? null,
      isValid: input.isValid,
      createdAt: now(),
    };
    await this.db.insert(responses).values(response).run();
    return response;
  }

  async listResponses(formId: string): Promise<FormResponse[]> {
    return this.db
      .select()
      .from(responses)
      .where(eq(responses.formId, formId))
      .orderBy(desc(responses.createdAt))
      .all();
  }

  async getResponse(id: string): Promise<FormResponse | null> {
    return (await this.db.select().from(responses).where(eq(responses.id, id)).get()) ?? null;
  }
}
