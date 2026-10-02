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
 * - An optional key is omitted, never sent as `null`. "Absent" takes the core's
 *   default; a present value of the wrong type is a failure (SPEC C-6).
 */

/** A resolved component version handed to `compile`. */
export interface ComponentReference {
  readonly code: string;
  readonly version: string;
  readonly formSchemaJson: string;
  readonly uiSchemaJson?: string;
  readonly contentHash?: string;
}

/**
 * The twelve field type names a form document may declare.
 *
 * The set is closed and matched case-sensitively, with no aliases (SPEC D-2), so
 * `email`, `bool`, `dropdown` and `section` are not field types: a caller using
 * those names converts them to one of the twelve before submitting a document.
 */
export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "datetime"
  | "time"
  | "choice"
  | "group"
  | "repeater"
  | "component-ref";

export interface CompileRequest {
  /** JSON text of the form schema. Required. */
  readonly formSchemaJson: string;
  /** JSON text of the UI schema. */
  readonly uiSchemaJson?: string;
  /** JSON text of the rules schema. */
  readonly rulesSchemaJson?: string;
  /**
   * Resolved component versions. `component-ref` fields are expanded from
   * these; there is no repository and no callback, so the caller decides what
   * "published" means by choosing what to hand in.
   */
  readonly components?: readonly ComponentReference[];
}

/** One field, as `colander_describe_form` reports it. */
export interface DescribedField {
  /** How the rules and the UI reference the field. */
  readonly id: string;
  /** The code the document declares. Present for every valid field. */
  readonly code: string;
  /** JSON pointer to the field, the string an `errors[].path` points at. */
  readonly path: string;
  /** The container's pointer, `null` for a top-level field. */
  readonly parentPath: string | null;
  /** One of the twelve field type names. */
  readonly type: FieldType;
  /** The schema baseline, not a rule evaluation. */
  readonly required: boolean;
  /** The schema baseline `evaluateRules` derives `enabled` from. */
  readonly readOnly: boolean;
}

export interface DescribedForm {
  /** Every field, in document order, including groups and repeater children. */
  readonly fields: readonly DescribedField[];
  /** The hash of the compiled triple that was described. */
  readonly contentHash: string;
}

export interface DescribeFormRequest {
  readonly formSchemaJson: string;
  readonly uiSchemaJson?: string;
  readonly rulesSchemaJson?: string;
  readonly components?: readonly ComponentReference[];
}

export interface CompiledForm {
  /** Canonical form schema, `component-ref` expanded. Keys sorted. */
  readonly formSchemaJson: string;
  readonly uiSchemaJson: string | null;
  readonly rulesSchemaJson: string | null;
  /** The component list plus the rule evaluation order. */
  readonly dependencyMetadataJson: string;
  /** Lowercase hex SHA-256 of the compiled triple. */
  readonly contentHash: string;
}

export interface EvaluateRulesRequest {
  /** JSON text of the form schema. Required. */
  readonly formSchemaJson: string;
  /** JSON text of the rules schema. Required. */
  readonly rulesSchemaJson: string;
  /** JSON text of the UI schema. Only `fields.<id>.hidden` is read. */
  readonly uiSchemaJson?: string;
  /** Current answers. **Keys are field codes**, not field ids. */
  readonly values?: Readonly<Record<string, unknown>>;
}

export interface ValidationError {
  readonly code: string;
  readonly message: string;
}

export interface RuleEvaluation {
  /** Keyed by **field id**. */
  readonly visibility: Readonly<Record<string, boolean>>;
  /** Keyed by **field id**. */
  readonly enabled: Readonly<Record<string, boolean>>;
  /** Keyed by **field id**. */
  readonly required: Readonly<Record<string, boolean>>;
  /** Keyed by **field code**. Only fields with a `calculate` expression. */
  readonly calculatedValues: Readonly<Record<string, unknown>>;
  readonly validationErrors: readonly ValidationError[];
}

export type ValidationMode = "Draft" | "Complete";

export interface ValidateResponseRequest {
  /** JSON text of the form schema. Required. */
  readonly formSchemaJson: string;
  /** JSON text of the answers; must parse to an object. Required. */
  readonly answersJson: string;
  /** Not read by this entry point; accepted for symmetry. */
  readonly uiSchemaJson?: string;
  /** Absent or blank means "no rules", which cannot raise a version mismatch. */
  readonly rulesSchemaJson?: string;
  /** Defaults to `"Draft"`. */
  readonly mode?: ValidationMode;
}

export interface ResponseError {
  readonly code: string;
  /**
   * A JSON pointer to the field's location **in the form schema** — not in the
   * answers. Two exceptions: an unknown answer key reports `/answers/<key>`,
   * and a failed cross-field validation reports `/rules/validations`.
   */
  readonly path: string;
  readonly message: string;
}

export interface ResponseValidation {
  /** Compact JSON object of the values that were accepted and converted. */
  readonly normalizedAnswersJson: string;
  readonly errors: readonly ResponseError[];
  readonly isValid: boolean;
}

export type SchemaKind = "form" | "component" | "workflow" | "instance";

export interface ValidateSchemaRequest {
  /** Defaults to `"form"`. */
  readonly kind?: SchemaKind;
  readonly formSchemaJson?: string;
  readonly uiSchemaJson?: string;
  readonly rulesSchemaJson?: string;
  readonly workflowSchemaJson?: string;
  /** For `kind:"instance"`: the instance and the schema to check it against. */
  readonly schemaJson?: string;
  readonly instanceJson?: string;
  /** Names the document in error messages. Defaults to `"instance"`. */
  readonly label?: string;
  /** The JSON Schema text for each document kind that needs one. */
  readonly schemas?: Readonly<Record<string, string>>;
}

/**
 * The outcome of `validateSchema`.
 *
 * **The ABI never returns `{"valid":false}`.** A document that fails its schema
 * comes back as a failure envelope instead, so this binding turns that envelope
 * back into a result: a validator that throws on "invalid" is unusable.
 *
 * The invalid branch carries the core's failure `code` — the `SCREAMING_SNAKE`
 * token the message opens with, empty when it opens with prose. For
 * `kind:"form"` this is the only place the `RULE_*` codes surface.
 */
export type SchemaResult = { valid: true } | { valid: false; code: string; message: string };

/** The public result of `validateSchema`, as the core's own types read it. */
export type SchemaCheck =
  | { readonly valid: true }
  | { readonly valid: false; readonly code: string; readonly message: string };

export interface ContentHashRequest {
  /** JSON text of the form schema. Required. */
  readonly formSchemaJson: string;
  readonly uiSchemaJson?: string;
  readonly rulesSchemaJson?: string;
}

/** How far above the highest published version to move. */
export type VersionBump = "patch" | "minor" | "major";

export interface NextVersionRequest {
  /** Published versions, in any order. Defaults to an empty list. */
  readonly published?: readonly string[];
  /**
   * How far to bump. Defaults to `"patch"`; any other name is rejected with
   * `INVALID_SEMVER`. Omit the key rather than sending `null`: a present value
   * of the wrong JSON type is an error, not an absence (SPEC C-6).
   */
  readonly bump?: VersionBump;
}

export interface VersionInfo {
  readonly name: string;
  readonly version: string;
  readonly abi: number;
}
