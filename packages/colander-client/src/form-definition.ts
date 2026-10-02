import type {
  ColanderFieldType,
  CompileRequest,
  CompiledForm,
  ComponentReference,
  DescribedField,
  DescribedForm,
  EvaluateRulesRequest,
  Field,
  FieldOption,
  FormSchema,
  LayoutNode,
  RulesSchema,
  UiSchema,
  ValidateResponseRequest,
  ValidationMode,
} from "./types.js";

export type {
  ColanderFieldType,
  ComponentReference,
  Field,
  FieldOption,
  FieldType,
  FormSchema,
  LayoutNode,
  RulesSchema,
  UiSchema,
} from "./types.js";

/** A field resolved back from a JSON pointer into the compiled form schema. */
export interface FormFieldPointer {
  readonly id: string;
  readonly code: string;
}

export type LeafFieldType = Exclude<ColanderFieldType, "group" | "repeater" | "component-ref">;

/** Common metadata for every node in a compiled form definition. */
export interface FormNodeBase {
  readonly id: string;
  readonly code: string;
  readonly pointer: string;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
  readonly readOnly: boolean;
}

export interface LeafNode extends FormNodeBase {
  readonly kind: "field";
  readonly type: LeafFieldType;
  readonly field: Field;
  readonly options: readonly FieldOption[];
}

export interface GroupNode extends FormNodeBase {
  readonly kind: "group";
  readonly type: "group" | "component-ref";
  readonly field: Field;
  readonly children: readonly FormNode[];
}

export interface RepeaterNode extends FormNodeBase {
  readonly kind: "repeater";
  readonly type: "repeater";
  readonly field: Field;
  readonly children: readonly FormNode[];
}

export type FormNode = LeafNode | GroupNode | RepeaterNode;

/** Parsed source documents accepted by the compile request builder. */
export interface FormDefinitionInput {
  readonly form: FormSchema;
  readonly rules?: RulesSchema | null;
  readonly ui?: UiSchema | null;
  /** Resolved component versions forwarded by the compile boundary. */
  readonly components?: readonly ComponentReference[];
}

/**
 * The core's description of a compiled form, plus the documents it describes.
 *
 * The description is authoritative for identity, pointers, types and the two
 * baseline flags. The form document is read only for what the core does not
 * model: a choice's options, and a title a document may carry.
 */
export interface DescribedDefinitionInput {
  readonly described: DescribedForm;
  readonly form: FormSchema;
  readonly ui?: UiSchema | null;
  readonly rules?: RulesSchema | null;
}

/**
 * A read-only, renderer-neutral index of one compiled form.
 *
 * The source documents are object data at this layer. A compiled wire result
 * is decoded only by `createFormDefinitionFromCompiled`; callers continue to
 * forward the original compiled strings unchanged to transport operations.
 */
export interface FormDefinition {
  readonly root: readonly FormNode[];
  /** Field id -> field code */
  readonly codeById: Readonly<Record<string, string>>;
  /** Field code -> field id */
  readonly idByCode: Readonly<Record<string, string>>;
  /** JSON pointer into the form schema -> field id and code */
  readonly byPointer: Readonly<Record<string, FormFieldPointer>>;
  /** Field id -> the JSON pointer the core assigned it */
  readonly pathById: Readonly<Record<string, string>>;
  /** Field codes with a calculate rule; these fields are read-only */
  readonly calculatedCodes: ReadonlySet<string>;
  /** Field codes declared readOnly by the form schema */
  readonly staticReadOnlyCodes: ReadonlySet<string>;
  /** Field ids declared readOnly by the form schema */
  readonly staticReadOnlyById: Readonly<Record<string, boolean>>;
  /** Field ids declared required by the form schema */
  readonly staticRequiredById: Readonly<Record<string, boolean>>;
  /**
   * Field ids hidden by the UI schema.
   *
   * The core reads `ui.fields[id].hidden` and nothing else, so this index has a
   * single source on purpose. A layout node's `hidden` flag is not a second one:
   * honouring it here would let the renderer disagree with the core about the
   * same field.
   */
  readonly hiddenById: Readonly<Record<string, boolean>>;
  /** Every indexed field id, including fields that cannot be rendered */
  readonly fieldIds: readonly string[];
  /** Direct parent field id for nested fields */
  readonly parentIdById: Readonly<Record<string, string>>;
  /** Field id -> all nested field ids */
  readonly descendantIds: Readonly<Record<string, readonly string[]>>;
  /** Field id -> top-level answer codes governed by that container */
  readonly descendantCodes: Readonly<Record<string, readonly string[]>>;
  /** Field id -> display label */
  readonly labelById: Readonly<Record<string, string>>;
  /** Field code -> display label */
  readonly labelByCode: Readonly<Record<string, string>>;
}

/** Where a response error path points, once resolved against the index. */
export interface ResolvedField {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly pointer: string;
  readonly kind: "field" | "answers" | "rules";
}

/** Decode one JSON document at an explicit source boundary. */
function parseDocument<T>(text: string | null | undefined, label: string): T | null {
  if (text === null || text === undefined) {
    return null;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not valid JSON: ${reason}`, { cause: error });
  }
}

function stringifyDocument(document: object, label: string): string {
  const text = JSON.stringify(document);
  if (text === undefined) {
    throw new Error(`${label} could not be serialized as JSON`);
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isField(value: unknown): value is Field {
  return isRecord(value) && typeof value["type"] === "string";
}

function isFieldOption(value: unknown): value is FieldOption {
  return isRecord(value) && typeof value["value"] === "string";
}

function isLayoutNode(value: unknown): value is LayoutNode {
  return isRecord(value) && typeof value["type"] === "string";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** `body.weight.kg` / `bodyWeight` -> `Body weight kg`. */
export function humanizeCode(code: string): string {
  const words = code
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._\-\s/]+/)
    .filter((part) => part.length > 0);
  if (words.length === 0) {
    return code;
  }
  const joined = words.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

interface LayoutMetadata {
  title?: string;
  description?: string;
}

function collectLayoutMetadata(
  nodes: readonly LayoutNode[] | undefined,
  into: Map<string, LayoutMetadata>,
): void {
  if (!Array.isArray(nodes)) {
    return;
  }
  for (const node of nodes) {
    if (!isLayoutNode(node)) {
      continue;
    }
    const fieldId = asString(node.fieldId);
    if (fieldId.length > 0) {
      const existing = into.get(fieldId) ?? {};
      const title = asString(node.title);
      const description = asString(node.description);
      if (title.length > 0) {
        existing.title = title;
      }
      if (description.length > 0) {
        existing.description = description;
      }
      into.set(fieldId, existing);
    }
    collectLayoutMetadata(node.children, into);
    collectLayoutMetadata(node.itemTemplate, into);
  }
}

function optionChoices(field: Field): FieldOption[] {
  const options = Array.isArray(field.options) ? field.options : [];
  return options
    .map((option) => {
      if (!isFieldOption(option)) {
        return null;
      }
      const { value } = option;
      if (value.length === 0) {
        return null;
      }
      const label = asString(option.label);
      return label.length > 0 ? { label, value } : { value };
    })
    .filter((choice): choice is FieldOption => choice !== null);
}

function collectDescendantIds(nodes: readonly FormNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.id.length > 0) {
      ids.push(node.id);
    }
    if (node.kind === "group" || node.kind === "repeater") {
      ids.push(...collectDescendantIds(node.children));
    }
  }
  return ids;
}

function collectAnswerCodes(nodes: readonly FormNode[]): string[] {
  const codes: string[] = [];
  for (const node of nodes) {
    if (node.kind === "field") {
      if (node.code.length > 0) {
        codes.push(node.code);
      }
    } else if (node.kind === "repeater") {
      if (node.code.length > 0) {
        codes.push(node.code);
      }
    } else {
      codes.push(...collectAnswerCodes(node.children));
    }
  }
  return codes;
}

export function createFormDefinitionFromDescribed(input: DescribedDefinitionInput): FormDefinition {
  const form = input.form ?? {};
  const rules = input.rules ?? null;
  const ui = input.ui ?? null;
  const { described } = input;
  const rootFields = Array.isArray(form.fields) ? form.fields : [];

  // Identity, pointers, types and the two baseline flags come from the core's
  // Own index, read straight out of the description. The form document is only
  // Consulted for what the core deliberately does not model: the options of a
  // Choice, and the inert title a document may carry.
  const codeById: Record<string, string> = {};
  const idByCode: Record<string, string> = {};
  const byPointer: Record<string, FormFieldPointer> = {};
  const staticReadOnlyById: Record<string, boolean> = {};
  const staticRequiredById: Record<string, boolean> = {};
  const fieldIds = new Set<string>();
  const idByPath: Record<string, string> = {};
  const pathById: Record<string, string> = {};

  for (const entry of described.fields) {
    idByPath[entry.path] = entry.id;
    if (entry.id.length > 0) {
      pathById[entry.id] = entry.path;
    }
    byPointer[entry.path] = { code: entry.code, id: entry.id };
    if (entry.id.length === 0) {
      continue;
    }
    fieldIds.add(entry.id);
    if (entry.readOnly) {
      staticReadOnlyById[entry.id] = true;
    }
    if (entry.required) {
      staticRequiredById[entry.id] = true;
    }
    if (entry.code.length > 0) {
      codeById[entry.id] = entry.code;
      idByCode[entry.code] = entry.id;
    }
  }

  // The parent link is the core's, read back through its own pointer vocabulary.
  // Deriving it from the description removes the last place this package used
  // To concatenate JSON pointers by hand.
  const parentIdById: Record<string, string> = {};
  for (const entry of described.fields) {
    if (entry.parentPath === null) {
      continue;
    }
    const parentId = idByPath[entry.parentPath];
    if (parentId !== undefined && parentId.length > 0) {
      parentIdById[entry.id] = parentId;
    }
  }

  const staticReadOnlyCodes = new Set<string>();
  for (const [id, code] of Object.entries(codeById)) {
    if (staticReadOnlyById[id] === true) {
      staticReadOnlyCodes.add(code);
    }
  }

  const calculatedCodes = new Set<string>();
  const ruleFields = isRecord(rules?.fields) ? (rules?.fields ?? {}) : {};
  for (const [ruleId, fieldRule] of Object.entries(ruleFields)) {
    if (!isRecord(fieldRule)) {
      continue;
    }
    if (fieldRule["calculate"] === null || fieldRule["calculate"] === undefined) {
      continue;
    }
    const code = codeById[ruleId];
    if (code !== undefined && code.length > 0) {
      calculatedCodes.add(code);
    }
  }

  const layoutMetadata = new Map<string, LayoutMetadata>();
  collectLayoutMetadata(ui?.layout, layoutMetadata);
  // The core reads `ui.fields[id].hidden` and nothing else, so this index has a
  // Single source on purpose. A layout node's `hidden` flag is not a second one:
  // Honouring it here would let the renderer disagree with the core about the
  // Same field.
  const hiddenById: Record<string, boolean> = {};
  if (isRecord(ui?.fields)) {
    for (const [id, entry] of Object.entries(ui.fields)) {
      if (isRecord(entry) && entry.hidden === true) {
        hiddenById[id] = true;
      }
    }
  }

  const labelById: Record<string, string> = {};
  const labelByCode: Record<string, string> = {};
  const descendantIds: Record<string, string[]> = {};
  const descendantCodes: Record<string, string[]> = {};

  const labelFor = (field: Field, id: string, code: string): string => {
    const fromLayout = id.length > 0 ? layoutMetadata.get(id)?.title : undefined;
    if (fromLayout !== undefined && fromLayout.length > 0) {
      return fromLayout;
    }
    const own = asString(field.title);
    if (own.length > 0) {
      return own;
    }
    return humanizeCode(code.length > 0 ? code : id);
  };

  const descriptionFor = (field: Field, id: string): string | undefined => {
    const fromLayout = id.length > 0 ? layoutMetadata.get(id)?.description : undefined;
    if (fromLayout !== undefined && fromLayout.length > 0) {
      return fromLayout;
    }
    const own = asString(field.description);
    return own.length > 0 ? own : undefined;
  };

  // The core indexed this same document, so entry N of `described.fields` is the
  // Nth field of the form's depth-first walk. Walking the two together turns a
  // Silent disagreement into a loud one: a description that does not match the
  // Document it claims to describe throws instead of rendering a form with the
  // Wrong flags.
  let cursor = 0;
  const take = (documentType: string): DescribedField => {
    const entry = described.fields[cursor];
    cursor += 1;
    if (entry === undefined) {
      throw new Error(
        `The described form reports ${described.fields.length} fields, fewer than the form schema describes.`,
      );
    }
    if (entry.type !== documentType) {
      throw new Error(
        `The described form and the form schema disagree at ${entry.path}: the core reports type '${entry.type}' and the document says '${documentType}'.`,
      );
    }
    return entry;
  };

  const buildNode = (field: Field): FormNode => {
    const documentType = asString(field.type);
    const entry = take(documentType);
    const { id, code, path } = entry;
    const label = labelFor(field, id, code);
    const description = descriptionFor(field, id);
    if (id.length > 0) {
      labelById[id] = label;
    }
    if (code.length > 0) {
      labelByCode[code] = label;
    }

    const childFields = Array.isArray(field.items) ? field.items : [];
    const base = {
      id,
      code,
      pointer: path,
      label,
      ...(description === undefined ? {} : { description }),
      required: entry.required,
      // A calculated field is read-only: the core owns the value, so the caller
      // Must not be able to type over it.
      readOnly: entry.readOnly || (code.length > 0 && calculatedCodes.has(code)),
    };

    // `component-ref` is a container too. `compile` expands one, so a described
    // Form never carries it, but handling it keeps a hand-authored document
    // Walkable instead of silently dropping its children.
    if (documentType === "group" || documentType === "component-ref") {
      const children = childFields.filter(isField).map(buildNode);
      if (id.length > 0) {
        descendantIds[id] = collectDescendantIds(children);
        descendantCodes[id] = collectAnswerCodes(children);
      }
      return { ...base, children, field, kind: "group", type: documentType };
    }

    if (documentType === "repeater") {
      const children = childFields.filter(isField).map(buildNode);
      if (id.length > 0) {
        descendantIds[id] = collectDescendantIds(children);
        descendantCodes[id] = [code];
      }
      return { ...base, children, field, kind: "repeater", type: "repeater" };
    }

    if (id.length > 0) {
      descendantIds[id] = [code];
      descendantCodes[id] = [code];
    }
    return {
      ...base,
      field,
      kind: "field",
      options: optionChoices(field),
      type: documentType as LeafFieldType,
    };
  };

  const root = rootFields.filter(isField).map(buildNode);

  // Every described field was consumed, so the description and the document
  // Agree in both directions.
  if (cursor !== described.fields.length) {
    throw new Error(
      `The described form reports ${described.fields.length} fields, more than the form schema describes.`,
    );
  }

  return {
    byPointer,
    calculatedCodes,
    codeById,
    descendantCodes,
    descendantIds,
    fieldIds: [...fieldIds],
    hiddenById,
    idByCode,
    labelByCode,
    labelById,
    parentIdById,
    pathById,
    root,
    staticReadOnlyById,
    staticReadOnlyCodes,
    staticRequiredById,
  };
}

/**
 * Decode a compiled wire result plus its description into the form model.
 *
 * Each present document is parsed exactly once and the resulting objects are
 * delegated to {@link createFormDefinitionFromDescribed}. The compiled strings
 * themselves are not modified or re-serialized.
 */
export function createFormDefinitionFromCompiled(
  compiled: CompiledForm,
  described: DescribedForm,
): FormDefinition {
  return createFormDefinitionFromDescribed({
    described,
    form: parseDocument<FormSchema>(compiled.formSchemaJson, "formSchemaJson") ?? {},
    rules: parseDocument<RulesSchema>(compiled.rulesSchemaJson, "rulesSchemaJson"),
    ui: parseDocument<UiSchema>(compiled.uiSchemaJson, "uiSchemaJson"),
  });
}

/** Build a compile request while keeping raw-document serialization at the boundary. */
export function createCompileRequest(input: FormDefinitionInput): CompileRequest {
  return {
    formSchemaJson: stringifyDocument(input.form, "form"),
    ...(input.rules === null || input.rules === undefined
      ? {}
      : { rulesSchemaJson: stringifyDocument(input.rules, "rules") }),
    ...(input.ui === null || input.ui === undefined
      ? {}
      : { uiSchemaJson: stringifyDocument(input.ui, "ui") }),
    ...(input.components === undefined ? {} : { components: [...input.components] }),
  };
}

/**
 * Build a rule-evaluation request from compiled documents and object answers.
 * The compiled document strings are forwarded verbatim.
 *
 * Values are forwarded exactly as the caller holds them. The core owns answer
 * conversion (`V-2` puts type conversion inside the per-field check order), so
 * pre-converting here would make the core's conversion unreachable.
 *
 * The definition parameter is vestigial and reserved: nothing here reads it any
 * more. It stays in the signature so existing call sites keep compiling.
 */
export function createEvaluateRulesRequest(
  compiled: CompiledForm,
  _definition: FormDefinition,
  values: Record<string, unknown>,
): EvaluateRulesRequest {
  if (compiled.rulesSchemaJson === null) {
    throw new Error("Cannot evaluate rules without a compiled rules document");
  }
  return {
    formSchemaJson: compiled.formSchemaJson,
    rulesSchemaJson: compiled.rulesSchemaJson,
    ...(compiled.uiSchemaJson === null ? {} : { uiSchemaJson: compiled.uiSchemaJson }),
    values,
  };
}

/**
 * Build a final response-validation request from compiled documents and object
 * answers.
 *
 * The caller's values are serialized as they are. Nothing is filtered and
 * nothing is converted:
 *
 * - A calculated answer stays in the payload, because `V-8` reports a stale
 *   calculated value as `CALCULATED_VALUE_MISMATCH`. Dropping it here would
 *   make that error impossible to observe.
 * - A string stays a string, because the core's conversion is strict and
 *   reports `INVALID_TYPE` for a string in a `number` field. Converting here
 *   would hide the error the caller needs to see.
 *
 * The definition parameter is vestigial and reserved: nothing here reads it any
 * more. It stays in the signature so existing call sites keep compiling.
 */
export function createValidateResponseRequest(
  compiled: CompiledForm,
  _definition: FormDefinition,
  values: Record<string, unknown>,
  mode: ValidationMode,
): ValidateResponseRequest {
  return {
    formSchemaJson: compiled.formSchemaJson,
    answersJson: stringifyDocument(values, "answers"),
    ...(compiled.rulesSchemaJson === null ? {} : { rulesSchemaJson: compiled.rulesSchemaJson }),
    ...(compiled.uiSchemaJson === null ? {} : { uiSchemaJson: compiled.uiSchemaJson }),
    mode,
  };
}

function decodePointerPart(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A malformed escape is still a usable, literal pointer segment. Error
    // Mapping must never turn a backend message into a consumer-side exception.
  }
  return decoded.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pointerCandidates(path: string): string[] {
  const decoded = decodePointerPart(path);
  return decoded === path ? [path] : [path, decoded];
}

function labelForReference(definition: FormDefinition, id: string, code: string): string {
  return (
    definition.labelById[id] ??
    definition.labelByCode[code] ??
    humanizeCode(code.length > 0 ? code : id)
  );
}

/**
 * Resolve a response error path back to a field.
 *
 * Paths point into the form schema (`/fields/2`, `/fields/2/items/0`). The two
 * documented exceptions are `/answers/<code>` and `/rules/validations`.
 * Returns `null` when nothing matches.
 */
export function resolveFieldForPath(
  definition: FormDefinition,
  path: string,
): ResolvedField | null {
  if (typeof path !== "string" || path.length === 0) {
    return null;
  }

  if (path === "/rules/validations" || path.startsWith("/rules/validations/")) {
    return {
      code: "",
      id: "",
      kind: "rules",
      label: "Cross-field validation",
      pointer: path,
    };
  }

  if (path.startsWith("/answers/")) {
    const encoded = path.slice("/answers/".length);
    const key = decodePointerPart(encoded);
    if (key.length === 0) {
      return null;
    }
    const id = definition.idByCode[key];
    return {
      code: key,
      id: id ?? "",
      kind: "answers",
      label: labelForReference(definition, id ?? "", key),
      pointer: path,
    };
  }

  const resolvePointer = (pointer: string): ResolvedField | null => {
    const direct = definition.byPointer[pointer];
    if (direct !== undefined) {
      return {
        code: direct.code,
        id: direct.id,
        kind: "field",
        label: labelForReference(definition, direct.id, direct.code),
        pointer: path,
      };
    }
    return null;
  };

  for (const candidate of pointerCandidates(path)) {
    const direct = resolvePointer(candidate);
    if (direct !== null) {
      return direct;
    }
  }

  // Fall back to the closest ancestor, so a path into a subtree still resolves
  // To the field that owns it. The walk follows the core's own parent links
  // Rather than truncating the pointer: a nested field's pointer is its
  // Container's plus `/items/<n>`, so cutting at the last separator lands on
  // `/fields/0/items` and finds nothing.
  let owner: string | undefined = path;
  for (const candidate of pointerCandidates(path)) {
    const direct = definition.byPointer[candidate];
    if (direct !== undefined) {
      owner = direct.id;
      break;
    }
  }
  while (owner !== undefined && owner.length > 0) {
    const ownerPath = definition.pathById[owner];
    if (ownerPath === undefined) {
      return null;
    }
    const direct = definition.byPointer[ownerPath];
    if (direct !== undefined) {
      return {
        code: direct.code,
        id: direct.id,
        kind: "field",
        label: labelForReference(definition, direct.id, direct.code),
        pointer: path,
      };
    }
    owner = definition.parentIdById[owner];
  }

  return null;
}
