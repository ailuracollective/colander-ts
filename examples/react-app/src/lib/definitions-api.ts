import type { CompileRequest } from "@ailura/colander-client";

/**
 * The definitions resource as the application consumes it, independent of
 * where the definitions actually live.
 *
 * This mirrors how `src/lib/api.ts` keeps the core source-neutral: one
 * interface, one implementation, and the caller selects the delivery. A WASM or
 * in-memory implementation can satisfy the same interface without changing a
 * single call site.
 *
 * A `…Json` field is JSON **text**, in and out, exactly as it was received. The
 * core hashes the bytes it is given, so a document that is parsed and
 * re-serialized anywhere in this path would have its number literals rewritten
 * and its keys reordered — a different document with a different content hash.
 * Nothing in this module, or in the HTTP implementation it describes, parses a
 * document.
 */

/** The four documents a version is made of, as the text that was stored. */
export interface DefinitionDocuments {
  readonly formSchemaJson: string;
  readonly uiSchemaJson: string | null;
  readonly rulesSchemaJson: string | null;
  readonly componentsJson: string | null;
}

/** A definition as the list endpoint returns it. */
export interface DefinitionSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly versionCount: number;
  readonly isPublished: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A version as the list endpoints return it. */
export interface VersionSummary {
  readonly id: string;
  readonly formId: string;
  readonly version: number;
  readonly status: "draft" | "published";
  readonly contentHash: string | null;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

/**
 * The published version of a definition, with its documents as text.
 *
 * The three optional documents are nullable because the resource stores absence
 * as `null`; absence is a real state, and it is carried as absence rather than
 * as an empty document. `createPublishedCompileRequest` maps it the same way.
 */
export interface PublishedForm extends DefinitionDocuments {
  readonly id: string;
  readonly formId: string;
  readonly version: number;
  readonly status: "draft" | "published";
  readonly contentHash: string | null;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

/**
 * The core's verdict on the stored text, as a version read returns it.
 *
 * This is a dry-run of the core's `compile` over the exact bytes the version
 * holds, produced by the resource and not by the browser. An editor shows it as
 * it is: a second opinion computed in the client would be a second answer, and
 * the core is the only authority on whether a document is a form.
 *
 * The `valid: false` branch keeps the core's own `code` and `message`, so an
 * author is told what the core said rather than a paraphrase of it.
 */
export type LiveSchemaCheck =
  | { readonly valid: true; readonly contentHash?: string }
  | {
      readonly valid: false;
      readonly code?: string;
      readonly message: string;
    };

/**
 * One version, its four documents as text, and the core's verdict on them.
 *
 * This is the editor's load: the documents enter the model as the exact strings
 * the database stored, and `schemaCheck` is the core's answer about those same
 * strings.
 */
export interface VersionDetail extends VersionSummary, DefinitionDocuments {
  readonly schemaCheck: LiveSchemaCheck;
}

/**
 * Why a definitions call failed, as a small closed set a UI can branch on.
 *
 * `no_published_version` is a *state*, not a failure of the network: a form can
 * exist, be queried, and simply have nothing published yet. Keeping it apart
 * from `definition_not_found` and from `network` is the point of this union.
 * Codes that share a kind (the four conflict codes, for instance) are told apart
 * by `DefinitionsApiError.code`, which is the API's own code verbatim.
 */
export type DefinitionsErrorKind =
  | "network"
  | "definition_not_found"
  | "version_not_found"
  | "no_published_version"
  | "conflict"
  | "operation"
  | "unknown";

/** A source-neutral API for stored form definitions. */
export interface DefinitionsApi {
  readonly listDefinitions: () => Promise<DefinitionSummary[]>;
  readonly getPublished: (formId: string) => Promise<PublishedForm>;
  readonly getVersions: (formId: string) => Promise<VersionSummary[]>;
  readonly getVersion: (formId: string, versionId: string) => Promise<VersionDetail>;
  readonly saveDraft: (formId: string, documents: DefinitionDocuments) => Promise<VersionSummary>;
  /**
   * Store the four documents on an existing draft.
   *
   * Never gated by the core: a draft is allowed to be invalid, and the verdict
   * about it arrives separately on the next {@link DefinitionsApi.getVersion} as
   * that version's `schemaCheck`. A published version answers a conflict, and
   * the only way forward from one is {@link DefinitionsApi.cloneVersion}.
   */
  readonly updateDraft: (
    formId: string,
    versionId: string,
    documents: DefinitionDocuments,
  ) => Promise<VersionSummary>;
  readonly publishVersion: (formId: string, versionId: string) => Promise<VersionSummary>;
  /** Copy a version into a new editable draft; the source is left untouched. */
  readonly cloneVersion: (formId: string, versionId: string) => Promise<VersionSummary>;
}

/**
 * Whether the documents on screen differ from the documents in storage.
 *
 * The dirty state is *decided*, never remembered: both sides are text produced by
 * the model's one serialisation, and a boolean that some handler has to remember
 * to set goes stale the moment an edit is refused, a drop is cancelled, or a
 * save fails. Comparing the two strings answers the only question that matters —
 * is what I would store different from what is stored?
 *
 * Both arguments are the same four nullable strings, so the caller passes the
 * model's current serialisation and the baseline it captured when it loaded.
 * `formSchemaJson` is compared byte for byte, like the core's hash: a document
 * is text, and a re-serialised document is a different document.
 */
export function hasUnsavedChanges(
  current: DefinitionDocuments,
  stored: DefinitionDocuments,
): boolean {
  return (
    current.formSchemaJson !== stored.formSchemaJson ||
    current.uiSchemaJson !== stored.uiSchemaJson ||
    current.rulesSchemaJson !== stored.rulesSchemaJson ||
    current.componentsJson !== stored.componentsJson
  );
}

export { DefinitionsApiError, toDefinitionsApiError } from "./http-definitions-api";
export type { DefinitionsErrorBody } from "./http-definitions-api";

/**
 * Build the compile request for a published version, from its text.
 *
 * The four documents are forwarded as the strings the API returned. Nothing is
 * parsed, re-ordered, or re-serialized, so the core hashes exactly the bytes the
 * database stored. A `null` document is forwarded as an absent document, which
 * is what it is.
 *
 * `componentsJson` has no field on `CompileRequest`: the compile contract takes
 * caller-resolved component references, not a components document, so the
 * stored text is carried on `PublishedForm` and never silently reshaped here.
 */
export function createPublishedCompileRequest(published: PublishedForm): CompileRequest {
  return {
    formSchemaJson: published.formSchemaJson,
    ...(published.uiSchemaJson === null ? {} : { uiSchemaJson: published.uiSchemaJson }),
    ...(published.rulesSchemaJson === null ? {} : { rulesSchemaJson: published.rulesSchemaJson }),
  };
}
