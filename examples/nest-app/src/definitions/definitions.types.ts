import type { SchemaCheck } from "@ailura/colander";

import type { FormDefinition, FormVersion } from "../db/forms.repository.js";

/**
 * The HTTP contract of the definitions resource.
 *
 * A `…Json` field is JSON **text**, in and out, exactly as the computation
 * routes already require: the core hashes the bytes it receives, and a document
 * that is parsed and re-serialized here would get its number literals rewritten
 * and its keys reordered, which is a different document and a different content
 * hash. Nothing in this module parses a document.
 */

/** The one error shape every failure on this resource returns. */
export interface DefinitionsErrorBody {
  code: string;
  message: string;
}

export interface CreateDefinitionBody {
  name?: string;
  description?: string;
}

export interface UpdateDefinitionBody {
  name?: string;
  description?: string;
}

/** The four documents a version is made of, as the text that was received. */
export interface VersionDocumentsBody {
  formSchemaJson?: string;
  uiSchemaJson?: string;
  rulesSchemaJson?: string;
  componentsJson?: string;
}

/** A version as the list endpoints return it. */
export interface VersionSummary {
  id: string;
  formId: string;
  version: number;
  status: FormVersion["status"];
  contentHash: string | null;
  createdAt: string;
  publishedAt: string | null;
}

/** A definition as the list endpoint returns it. */
export interface DefinitionSummary {
  id: string;
  name: string;
  description: string;
  versionCount: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DefinitionDetail {
  definition: FormDefinition;
  versions: VersionSummary[];
}

/**
 * One version plus a live dry-run of the core over the same document text.
 * `schemaCheck` is a read, never a precondition: it is what the editor renders
 * while a draft is still incomplete.
 */
export interface VersionDetail {
  version: FormVersion;
  schemaCheck: LiveSchemaCheck;
}

/**
 * `SchemaCheck` widened with the content hash the same dry-run produced, so an
 * editor can show "valid, and this is the hash it will publish with" from one
 * call. The `valid: false` branch carries the core's own failure code.
 */
export type LiveSchemaCheck = SchemaCheck & { contentHash?: string };
