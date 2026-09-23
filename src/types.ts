/**
 * The request and result shapes of colander's data-carrying entry points.
 *
 * These mirror the published colander C ABI. Two conventions are worth knowing
 * before reading them:
 *
 * - Every `…Json` field is **JSON held as a string**, not a parsed object. The
 *   core preserves number literals and rejects nothing on the way in, so the
 *   text travels as text. Passing `JSON.stringify(parsed)` is usually a
 *   mistake: it rewrites `1.50` to `1.5` and can reorder keys, and the content
 *   hash covers the bytes.
 * - The `values` map of `evaluateRules` is the exception: it is a real object,
 *   and its **keys are field codes**.
 */

/** A resolved component version handed to `compile`. */
export interface ComponentReference {
  code: string;
  version: string;
  formSchemaJson: string;
  uiSchemaJson?: string;
  contentHash?: string;
}

export interface CompileRequest {
  /** JSON text of the form schema. Required. */
  formSchemaJson: string;
  /** JSON text of the UI schema. */
  uiSchemaJson?: string;
  /** JSON text of the rules schema. */
  rulesSchemaJson?: string;
  /**
   * Resolved component versions. `component-ref` fields are expanded from
   * these; there is no repository and no callback, so the caller decides what
   * "published" means by choosing what to hand in.
   */
  components?: ComponentReference[];
}

export interface CompiledForm {
  /** Canonical form schema, `component-ref` expanded. Keys sorted. */
  formSchemaJson: string;
  uiSchemaJson: string | null;
  rulesSchemaJson: string | null;
  /** The component list plus the rule evaluation order. */
  dependencyMetadataJson: string;
  /** Lowercase hex SHA-256 of the compiled triple. */
  contentHash: string;
}

export interface EvaluateRulesRequest {
  /** JSON text of the form schema. Required. */
  formSchemaJson: string;
  /** JSON text of the rules schema. Required. */
  rulesSchemaJson: string;
  /** JSON text of the UI schema. Only `fields.<id>.hidden` is read. */
  uiSchemaJson?: string;
  /** Current answers. **Keys are field codes**, not field ids. */
  values?: Record<string, unknown>;
}

export interface ValidationError {
  code: string;
  message: string;
}

export interface RuleEvaluation {
  /** Keyed by **field id**. */
  visibility: Record<string, boolean>;
  /** Keyed by **field id**. */
  enabled: Record<string, boolean>;
  /** Keyed by **field id**. */
  required: Record<string, boolean>;
  /** Keyed by **field code**. Only fields with a `calculate` expression. */
  calculatedValues: Record<string, unknown>;
  validationErrors: ValidationError[];
}

export type ValidationMode = "Draft" | "Complete";

export interface ValidateResponseRequest {
  /** JSON text of the form schema. Required. */
  formSchemaJson: string;
  /** JSON text of the answers; must parse to an object. Required. */
  answersJson: string;
  /** Not read by this entry point; accepted for symmetry. */
  uiSchemaJson?: string;
  /** Absent or blank means "no rules", which cannot raise a version mismatch. */
  rulesSchemaJson?: string;
  /** Defaults to `"Draft"`. */
  mode?: ValidationMode;
}

export interface ResponseError {
  code: string;
  /**
   * A JSON pointer to the field's location **in the form schema** — not in the
   * answers. Two exceptions: an unknown answer key reports `/answers/<key>`,
   * and a failed cross-field validation reports `/rules/validations`.
   */
  path: string;
  message: string;
}

export interface ResponseValidation {
  /** Compact JSON object of the values that were accepted and converted. */
  normalizedAnswersJson: string;
  errors: ResponseError[];
  isValid: boolean;
}

export type SchemaKind = "form" | "component" | "workflow" | "instance";

export interface ValidateSchemaRequest {
  /** Defaults to `"form"`. */
  kind?: SchemaKind;
  formSchemaJson?: string;
  uiSchemaJson?: string;
  rulesSchemaJson?: string;
  workflowSchemaJson?: string;
  /** For `kind:"instance"`: the instance and the schema to check it against. */
  schemaJson?: string;
  instanceJson?: string;
  /** Names the document in error messages. Defaults to `"instance"`. */
  label?: string;
  /** The JSON Schema text for each document kind that needs one. */
  schemas?: Record<string, string>;
  /** Accepted for `kind:"workflow"`; unused by the core. */
  published?: unknown;
}

/**
 * The outcome of `validateSchema`.
 *
 * **The ABI never returns `{"valid":false}`.** A document that fails its schema
 * comes back as a failure envelope instead, so this binding turns that envelope
 * back into a result: a validator that throws on "invalid" is unusable.
 */
export type SchemaCheck = { valid: true } | { valid: false; message: string };

export interface ContentHashRequest {
  /** JSON text of the form schema. Required. */
  formSchemaJson: string;
  uiSchemaJson?: string;
  rulesSchemaJson?: string;
}

export interface NextVersionRequest {
  /** Published versions, in any order. Defaults to an empty list. */
  published?: string[];
}

export interface VersionInfo {
  name: string;
  version: string;
  abi: number;
}
