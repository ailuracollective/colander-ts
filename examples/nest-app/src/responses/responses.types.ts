import type { ValidationMode } from "@ailura/colander";

import type { FormResponse } from "../db/forms.repository.js";

/**
 * The HTTP contract of the responses resource.
 *
 * `answersJson` is JSON **text**, in and out, exactly as the computation routes
 * already require: the core validated those bytes, and a parsed document that
 * was re-serialized here would not be the document that was answered. Nothing
 * in this module parses an answer set.
 */

/** The one error shape every failure on this resource returns. */
export interface ResponsesErrorBody {
  code: string;
  message: string;
}

/**
 * The submission body. `formId` and `answersJson` are all a normal submission
 * needs: the version is the form's published one.
 *
 * `versionId` is optional and names the version the answer is meant to be
 * against, for a caller that knows which one it is answering — a re-run of an
 * old answer set, or a client whose form was refreshed in place. It never
 * widens what is accepted: the repository still refuses a version that is not
 * published, or that belongs to another form.
 */
export interface SubmitResponseBody {
  formId?: string;
  answersJson?: string;
  versionId?: string;
  /**
   * Which verdict the core should reach. Absent means the core's own default,
   * `"Draft"`.
   *
   * This is not a detail. `isValid` on a stored response is read from the
   * core's answer, and in Draft mode that answer is lenient by design, so a
   * resource that never accepted a mode would store only ever the permissive
   * verdict and a `isValid` of `true` would carry no information. Which verdict a
   * submission is judged against is a business rule about the caller's process,
   * so the caller says and the core decides; the resource does not pick.
   */
  mode?: ValidationMode;
}

/**
 * One stored response, exactly as it was persisted: the answers as they
 * arrived, `validationJson` holding the core's own `ResponseValidation`, and
 * `isValid` derived from that result.
 *
 * There is no separate summary shape for the list endpoint: a response row is
 * small, and every column on it is the answer to a question the caller is
 * already asking, so nothing is dropped on the way out.
 */
export type ResponseRecord = FormResponse;
