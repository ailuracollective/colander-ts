import {
  type DefinitionDocuments,
  type DefinitionSummary,
  type DefinitionsApi,
  type DefinitionsErrorKind,
  type LiveSchemaCheck,
  type PublishedForm,
  type VersionDetail,
  type VersionSummary,
} from "./definitions-api";
import { API_BASE } from "./http-colander-transport";

/**
 * The HTTP implementation of the definitions resource.
 *
 * It reuses `API_BASE` and the request shape of the core transport rather than
 * inventing a second base URL or a second fetch convention, so both resources
 * answer from the same `/api` proxy and the same `VITE_API_BASE_URL`.
 */

/** The one error body every failure on this resource returns. */
export interface DefinitionsErrorBody {
  readonly code: string;
  readonly message: string;
}

/**
 * A failure from this source-specific adapter.
 *
 * A dedicated class rather than `ColanderApiError`: that one is bound to the
 * *core's* neutral category union, and the definitions resource speaks a
 * different vocabulary — `no_published_version` is a repository state that has
 * no place in a list of core failure categories. Extending that union would
 * have made the core transport claim a state the core can never report. So this
 * error carries its own `kind` union, the API's own `code` verbatim, and the
 * HTTP `status`.
 */
export class DefinitionsApiError extends Error {
  readonly kind: DefinitionsErrorKind;
  /** The API's own error code, kept verbatim so same-kind codes stay distinct. */
  readonly code: string | null;
  readonly status?: number;

  constructor(
    kind: DefinitionsErrorKind,
    message: string,
    options: { code?: string | null; status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DefinitionsApiError";
    this.kind = kind;
    this.code = options.code ?? null;
    this.status = options.status;
  }
}

/** Narrow any thrown value to the error the UI branches on. */
export function toDefinitionsApiError(error: unknown): DefinitionsApiError {
  if (error instanceof DefinitionsApiError) {
    return error;
  }
  if (error instanceof Error) {
    return new DefinitionsApiError("network", error.message, { cause: error });
  }
  return new DefinitionsApiError("network", String(error), { cause: error });
}

/** Codes that share a kind, kept distinct by `DefinitionsApiError.code`. */
const CONFLICT_CODES = new Set([
  "version_not_draft",
  "version_already_published",
  "version_immutable",
  "duplicate_version",
]);

function kindForCode(code: string): DefinitionsErrorKind {
  switch (code) {
    case "no_published_version":
      return "no_published_version";
    case "definition_not_found":
      return "definition_not_found";
    case "version_not_found":
      return "version_not_found";
    default:
      return CONFLICT_CODES.has(code) ? "conflict" : "operation";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorBody(value: unknown): value is DefinitionsErrorBody {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

/** A body that is not JSON stays as text; it is never a thrown parse error. */
function safeParse(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function malformedSuccess(path: string): DefinitionsApiError {
  return new DefinitionsApiError("operation", `Malformed successful response from ${path}.`, {
    code: "malformed_response",
  });
}

function parseDefinitionSummary(body: unknown, path: string): DefinitionSummary {
  if (
    !isRecord(body) ||
    typeof body.id !== "string" ||
    typeof body.name !== "string" ||
    typeof body.description !== "string" ||
    typeof body.versionCount !== "number" ||
    typeof body.isPublished !== "boolean" ||
    typeof body.createdAt !== "string" ||
    typeof body.updatedAt !== "string"
  ) {
    throw malformedSuccess(path);
  }
  return body as unknown as DefinitionSummary;
}

function parseVersionSummary(body: unknown, path: string): VersionSummary {
  if (
    !isRecord(body) ||
    typeof body.id !== "string" ||
    typeof body.formId !== "string" ||
    typeof body.version !== "number" ||
    (body.status !== "draft" && body.status !== "published") ||
    (body.contentHash !== null && typeof body.contentHash !== "string") ||
    typeof body.createdAt !== "string" ||
    (body.publishedAt !== null && typeof body.publishedAt !== "string")
  ) {
    throw malformedSuccess(path);
  }
  return body as unknown as VersionSummary;
}

function parsePublishedForm(body: unknown, path: string): PublishedForm {
  if (
    !isRecord(body) ||
    typeof body.formSchemaJson !== "string" ||
    (body.uiSchemaJson !== null && typeof body.uiSchemaJson !== "string") ||
    (body.rulesSchemaJson !== null && typeof body.rulesSchemaJson !== "string") ||
    (body.componentsJson !== null && typeof body.componentsJson !== "string")
  ) {
    throw malformedSuccess(path);
  }
  return {
    // The version identity and its timestamps come from the same validated
    // summary shape the list endpoints return.
    ...parseVersionSummary(body, path),
    // The documents are handed back as the same string objects: no parse, no
    // re-serialization, so the core hashes the bytes that were stored.
    formSchemaJson: body.formSchemaJson,
    uiSchemaJson: body.uiSchemaJson,
    rulesSchemaJson: body.rulesSchemaJson,
    componentsJson: body.componentsJson,
  };
}

/**
 * The core's own verdict, forwarded as it arrived.
 *
 * Nothing here decides whether a document is valid, and nothing here fills in a
 * message the core did not send: the browser has no second opinion to offer, so
 * a malformed verdict is reported as such rather than repaired into a guess.
 */
function parseLiveSchemaCheck(body: unknown, path: string): LiveSchemaCheck {
  if (!isRecord(body) || typeof body.valid !== "boolean") {
    throw malformedSuccess(path);
  }
  if (body.valid) {
    return typeof body.contentHash === "string"
      ? { valid: true, contentHash: body.contentHash }
      : { valid: true };
  }
  if (typeof body.message !== "string") {
    throw malformedSuccess(path);
  }
  return {
    valid: false,
    message: body.message,
    ...(typeof body.code === "string" ? { code: body.code } : {}),
  };
}

function parseVersionDetail(body: unknown, path: string): VersionDetail {
  if (!isRecord(body) || !isRecord(body.version)) {
    throw malformedSuccess(path);
  }
  const version = body.version;
  if (
    typeof version.formSchemaJson !== "string" ||
    (version.uiSchemaJson !== null && typeof version.uiSchemaJson !== "string") ||
    (version.rulesSchemaJson !== null && typeof version.rulesSchemaJson !== "string") ||
    (version.componentsJson !== null && typeof version.componentsJson !== "string")
  ) {
    throw malformedSuccess(path);
  }
  return {
    ...parseVersionSummary(version, path),
    // The documents are handed on as the same string objects the response
    // carried. Nothing parses or re-serialises them here, so the model receives
    // the bytes the database stored and the core's verdict is about those same
    // bytes.
    formSchemaJson: version.formSchemaJson,
    uiSchemaJson: version.uiSchemaJson,
    rulesSchemaJson: version.rulesSchemaJson,
    componentsJson: version.componentsJson,
    schemaCheck: parseLiveSchemaCheck(body.schemaCheck, path),
  };
}

function parseDefinitionSummaries(body: unknown, path: string): DefinitionSummary[] {
  if (!Array.isArray(body)) {
    throw malformedSuccess(path);
  }
  return body.map((entry) => parseDefinitionSummary(entry, path));
}

function parseVersionSummaries(body: unknown, path: string): VersionSummary[] {
  if (!Array.isArray(body)) {
    throw malformedSuccess(path);
  }
  return body.map((entry) => parseVersionSummary(entry, path));
}

async function request<T>(
  path: string,
  parse: (body: unknown, path: string) => T,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DefinitionsApiError(
      "network",
      `Could not reach the definitions API at ${API_BASE}. ${reason}`,
      { cause: error },
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DefinitionsApiError(
      "network",
      `Could not read the definitions API response. ${reason}`,
      {
        cause: error,
      },
    );
  }

  const body = safeParse(text);
  if (!response.ok) {
    const failure = isErrorBody(body) ? body : undefined;
    // A non-2xx without a JSON body is still a usable error: a 5xx is the
    // server's own failure, and an unclassified 4xx stays unclassified rather
    // than being reported as a state this resource never reached.
    const kind = failure
      ? kindForCode(failure.code)
      : response.status >= 500
        ? "operation"
        : "unknown";
    const message = failure?.message ?? `Request failed with HTTP ${response.status}.`;
    throw new DefinitionsApiError(kind, message, {
      ...(failure === undefined ? {} : { code: failure.code }),
      status: response.status,
    });
  }

  return parse(body, path);
}

function encodeId(value: string): string {
  return encodeURIComponent(value);
}

function documentsBody(documents: DefinitionDocuments): string {
  // The documents travel as text inside a JSON envelope. That is a transport
  // envelope, not a document round-trip: each document keeps its own bytes
  // because it is carried as a JSON string value.
  return JSON.stringify({
    formSchemaJson: documents.formSchemaJson,
    uiSchemaJson: documents.uiSchemaJson,
    rulesSchemaJson: documents.rulesSchemaJson,
    componentsJson: documents.componentsJson,
  });
}

/** This example's HTTP adapter for the stored definitions resource. */
export const httpDefinitionsApi: DefinitionsApi = {
  listDefinitions: () => request("/definitions", parseDefinitionSummaries),
  getPublished: (formId) =>
    request(`/definitions/${encodeId(formId)}/published`, parsePublishedForm),
  getVersions: (formId) =>
    request(`/definitions/${encodeId(formId)}/versions`, parseVersionSummaries),
  getVersion: (formId, versionId) =>
    request(`/definitions/${encodeId(formId)}/versions/${encodeId(versionId)}`, parseVersionDetail),
  updateDraft: (formId, versionId, documents) =>
    request(
      `/definitions/${encodeId(formId)}/versions/${encodeId(versionId)}`,
      parseVersionSummary,
      { method: "PATCH", body: documentsBody(documents) },
    ),
  cloneVersion: (formId, versionId) =>
    request(
      `/definitions/${encodeId(formId)}/versions/${encodeId(versionId)}/clone`,
      parseVersionSummary,
      { method: "POST" },
    ),
  saveDraft: (formId, documents) =>
    request(`/definitions/${encodeId(formId)}/versions`, parseVersionSummary, {
      method: "POST",
      body: documentsBody(documents),
    }),
  publishVersion: (formId, versionId) =>
    request(
      `/definitions/${encodeId(formId)}/versions/${encodeId(versionId)}/publish`,
      parseVersionSummary,
      { method: "POST" },
    ),
};
