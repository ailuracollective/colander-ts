/**
 * Wire-level request and result shapes for Colander operations.
 *
 * Every `…Json` field is JSON text held in a string. Adapters must forward that
 * text without parsing and serializing it again, because the content hash
 * covers the exact document bytes.
 */

/** A resolved component version supplied to a compile operation. */
export interface ComponentReference {
  readonly code: string;
  readonly version: string;
  readonly formSchemaJson: string;
  readonly uiSchemaJson?: string;
  readonly contentHash?: string;
}

export interface CompileRequest {
  readonly formSchemaJson: string;
  readonly uiSchemaJson?: string;
  readonly rulesSchemaJson?: string;
  readonly components?: readonly ComponentReference[];
}

/** One field, as `colander_describe_form` reports it. */
export interface DescribedField {
  readonly id: string;
  readonly code: string;
  /** JSON pointer to the field, the string an `errors[].path` points at. */
  readonly path: string;
  /** The container's pointer, `null` for a top-level field. */
  readonly parentPath: string | null;
  readonly type: string;
  readonly required: boolean;
  readonly readOnly: boolean;
}

/** The core's own field index for a compiled triple. */
export interface DescribedForm {
  readonly fields: readonly DescribedField[];
  readonly contentHash: string;
}

export interface DescribeFormRequest {
  readonly formSchemaJson: string;
  readonly uiSchemaJson?: string;
  readonly rulesSchemaJson?: string;
  readonly components?: readonly ComponentReference[];
}

export interface CompiledForm {
  readonly formSchemaJson: string;
  readonly uiSchemaJson: string | null;
  readonly rulesSchemaJson: string | null;
  readonly dependencyMetadataJson: string;
  readonly contentHash: string;
}

export interface ContentHashRequest {
  readonly formSchemaJson: string;
  readonly uiSchemaJson?: string;
  readonly rulesSchemaJson?: string;
}

export interface CoreInfo {
  readonly abiVersion: number;
  readonly versionInfo: VersionInfo;
}

export interface EvaluateRulesRequest {
  readonly formSchemaJson: string;
  readonly rulesSchemaJson: string;
  readonly uiSchemaJson?: string;
  readonly values?: Readonly<Record<string, unknown>>;
}

export interface ValidationError {
  readonly code: string;
  readonly message: string;
}

export interface RuleEvaluation<
  TCalculatedValues extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly visibility: Readonly<Record<string, boolean>>;
  readonly enabled: Readonly<Record<string, boolean>>;
  readonly required: Readonly<Record<string, boolean>>;
  /** Known calculated values are kept separate from caller-owned answers. */
  readonly calculatedValues: Readonly<TCalculatedValues>;
  readonly validationErrors: readonly ValidationError[];
}

export type ValidationMode = "Draft" | "Complete";

export interface ValidateResponseRequest {
  readonly formSchemaJson: string;
  readonly answersJson: string;
  readonly uiSchemaJson?: string;
  readonly rulesSchemaJson?: string;
  readonly mode?: ValidationMode;
}

export interface ResponseError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ResponseValidation {
  readonly normalizedAnswersJson: string;
  readonly errors: readonly ResponseError[];
  readonly isValid: boolean;
}

export type SchemaKind = "form" | "component" | "workflow" | "instance";

export interface ValidateSchemaRequest {
  readonly kind?: SchemaKind;
  readonly formSchemaJson?: string;
  readonly uiSchemaJson?: string;
  readonly rulesSchemaJson?: string;
  readonly workflowSchemaJson?: string;
  readonly schemaJson?: string;
  readonly instanceJson?: string;
  readonly label?: string;
  readonly schemas?: Readonly<Record<string, string>>;
  readonly published?: unknown;
}

export type SchemaCheck =
  | { readonly valid: true }
  | { readonly valid: false; readonly message: string };

export interface NextVersionRequest {
  readonly published?: readonly string[];
}

export interface VersionInfo {
  readonly name: string;
  readonly version: string;
  readonly abi: number;
}

/**
 * The twelve field types supported by the Colander document model.
 *
 * A mirror of the core vocabulary (`D-2`). The client does not treat it as its
 * own validation gate on core output; see `isKnownFieldType` for the narrow
 * case it does cover.
 */
export const COLANDER_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "time",
  "choice",
  "group",
  "repeater",
  "component-ref",
] as const;

export type ColanderFieldType = (typeof COLANDER_FIELD_TYPES)[number];

const KNOWN_FIELD_TYPES: ReadonlySet<string> = new Set(COLANDER_FIELD_TYPES);

/**
 * Match a field type against the core vocabulary, exactly and case-sensitively.
 *
 * This is a guard for the **object-first authoring path**, where a document is
 * built by hand and has not been through the core. It is not a re-validation of
 * core output: `E-4` makes an unknown type a failure envelope, so a document
 * that came back from `compile` cannot contain one and this never fires for it.
 * That is why the list may drift without breaking a compiled form — and why a
 * compiled form is the only input whose validity this package promises.
 */
export function isKnownFieldType(type: string): type is ColanderFieldType {
  return KNOWN_FIELD_TYPES.has(type);
}

/** A single choice. Only `value` is read by the core; `label` is presentation. */
export interface FieldOption {
  readonly value: string;
  readonly label?: string;
}

/** A known field type or a forward-compatible custom type. */
export type FieldType = ColanderFieldType | (string & {});

/** A field in a Colander form schema. Unknown keys are preserved but inert. */
export interface Field {
  readonly type: FieldType;
  readonly id?: string;
  readonly code?: string;
  readonly required?: boolean;
  readonly readOnly?: boolean;
  readonly items?: readonly Field[];
  readonly options?: readonly FieldOption[];
  readonly allowMultiple?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly multipleOf?: number;
  readonly decimalPlaces?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly description?: string;
  readonly title?: string;
  readonly [key: string]: unknown;
}

/** The parsed form document used to build a headless form definition. */
export interface FormSchema {
  readonly schemaVersion?: string;
  readonly $schema?: string;
  readonly fields?: readonly Field[];
  readonly [key: string]: unknown;
}

/** An expression node: `{ ref }`, `{ lit }`, or `{ op, args }`. */
export type Expression =
  | { readonly ref: string }
  | { readonly lit: unknown }
  | { readonly op: string; readonly args?: readonly Expression[] };

export interface FieldRules {
  readonly visibleWhen?: Expression | null;
  readonly enabledWhen?: Expression | null;
  readonly requiredWhen?: Expression | null;
  readonly calculate?: Expression | null;
}

export interface ValidationRule {
  readonly code: string;
  readonly message?: string;
  readonly when?: Expression;
  readonly assert?: Expression;
}

/** The parsed rules document used to identify calculated fields. */
export interface RulesSchema {
  readonly schemaVersion?: string;
  readonly formSchemaVersion?: string;
  readonly fields?: Readonly<Record<string, FieldRules>>;
  readonly validations?: readonly ValidationRule[];
  readonly [key: string]: unknown;
}

export interface UiFieldEntry {
  readonly hidden?: boolean;
  readonly [key: string]: unknown;
}

/** A presentation node in `ui.layout`. Unknown keys are inert to the model. */
export interface LayoutNode {
  readonly type: string;
  readonly id?: string;
  readonly title?: string;
  readonly description?: string;
  readonly fieldId?: string;
  readonly hidden?: boolean;
  readonly children?: readonly LayoutNode[];
  readonly itemTemplate?: readonly LayoutNode[];
  readonly addButtonLabel?: string;
  readonly removeButtonLabel?: string;
}

export interface UiSchema {
  readonly schemaVersion?: string;
  readonly formSchemaVersion?: string;
  readonly $schema?: string;
  readonly fields?: Readonly<Record<string, UiFieldEntry>>;
  readonly layout?: readonly LayoutNode[];
  readonly [key: string]: unknown;
}
