/**
 * The editor's document model: a form document held in memory, edited, and
 * serialised back to text.
 *
 * Three properties of this module are the point of it, not decoration.
 *
 * 1. **One serialisation, and it is the only one.** A version arrives as JSON
 *    *text* and the text that is stored is the text the core hashed. The model
 *    parses the text once on load and {@link serialiseDocuments} is the single
 *    producer of stored text, called once on save. There is no other
 *    serialisation in the module: nothing stringifies on a keystroke, and
 *    nothing hands a parsed object to a layer that will stringify it again.
 * 2. **Unknown keys round-trip untouched.** Every node keeps a live reference
 *    to the object it came from (`raw`), and every edit writes into that object
 *    rather than rebuilding it. A key the editor does not model cannot be
 *    dropped by an edit, because an edit is an assignment, not a projection.
 *    Nothing in this module projects a node back into a new object.
 * 3. **The type list is closed.** Nine materialisable leaf types and three
 *    containers, taken from the client the rest of the app already uses. A
 *    thirteenth type is refused, and a container is never treated as a field.
 */

import type { ColanderFieldType, Field, FieldOption } from "@ailura/colander-client";

import {
  assertExpression,
  FIELD_RULE_ROWS,
  RulesError,
  type ExpressionNode,
  type FieldRuleKey,
} from "./rules";

/** The nine types the core materialises as a control. */
export const MATERIALIZABLE_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "time",
  "choice",
] as const;

export type MaterializableFieldType = (typeof MATERIALIZABLE_FIELD_TYPES)[number];

/** The three types only the tree draws. `defineControl` throws for each. */
export const CONTAINER_FIELD_TYPES = ["group", "repeater", "component-ref"] as const;

export type ContainerFieldType = (typeof CONTAINER_FIELD_TYPES)[number];

/** The whole palette: nine + three. There is no twelfth type. */
export const EDITOR_FIELD_TYPES = [
  ...MATERIALIZABLE_FIELD_TYPES,
  ...CONTAINER_FIELD_TYPES,
] as const;

export type EditorFieldType = MaterializableFieldType | ContainerFieldType;

/** True only for the nine types the core materialises as a control. */
export function isMaterializableFieldType(type: string): type is MaterializableFieldType {
  return (MATERIALIZABLE_FIELD_TYPES as readonly string[]).includes(type);
}

/** True only for the three types that hold children instead of an answer. */
export function isContainerFieldType(type: string): type is ContainerFieldType {
  return (CONTAINER_FIELD_TYPES as readonly string[]).includes(type);
}

/** True for any of the twelve, and for nothing else. */
export function isEditorFieldType(type: string): type is EditorFieldType {
  return isMaterializableFieldType(type) || isContainerFieldType(type);
}

/**
 * Every reason the model refuses, as a code. A refusal is a value the caller
 * can branch on, never a thrown string and never a silent no-op.
 */
export type EditorModelErrorCode =
  | "INVALID_DOCUMENT"
  | "UNKNOWN_FIELD_TYPE"
  | "NODE_NOT_FOUND"
  | "DUPLICATE_ID"
  | "DUPLICATE_CODE"
  | "ILLEGAL_PLACEMENT"
  | "ILLEGAL_MOVE"
  | "ILLEGAL_INDEX"
  | "PROPERTY_NOT_EDITABLE"
  | "INVALID_PROPERTY_VALUE"
  | "MISSING_COMPONENT_REFERENCE"
  | "INVALID_EXPRESSION"
  | "INVALID_REFERENCE"
  | "INVALID_ARGUMENT_INDEX";

/** A refusal from the model, with a machine-readable `code`. */
export class EditorModelError extends Error {
  readonly code: EditorModelErrorCode;
  /** The field id the refusal is about, when it is about one. */
  readonly fieldId: string | null;

  constructor(code: EditorModelErrorCode, message: string, fieldId: string | null = null) {
    super(message);
    this.name = "EditorModelError";
    this.code = code;
    this.fieldId = fieldId;
  }
}

function refuse(code: EditorModelErrorCode, message: string, fieldId: string | null = null): never {
  throw new EditorModelError(code, message, fieldId);
}

/** The documents a version is made of, as text. Mirrors `DefinitionDocuments`. */
export interface EditorDocuments {
  readonly formSchemaJson: string;
  readonly uiSchemaJson: string | null;
  readonly rulesSchemaJson: string | null;
  /** Forwarded verbatim: this piece does not author components. */
  readonly componentsJson: string | null;
}

/** The text a version was loaded from. Absent documents are `null`, not `{}`. */
export interface SourceDocuments {
  readonly formSchemaJson: string;
  readonly uiSchemaJson?: string | null;
  readonly rulesSchemaJson?: string | null;
  readonly componentsJson?: string | null;
}

/**
 * Document properties of a `component-ref` that are not control properties.
 *
 * `EDITABLE_PROPERTIES` below describes what a **control** receives when it
 * draws a field, and that is what the inspector table is about. `componentCode`
 * and `componentVersion` are keys of the **field document** itself: the
 * canonical samples carry them (`src/samples.ts`, the address-card and
 * casework-context component references), and a `component-ref` without a
 * `componentCode` names no component, so the core cannot expand it and the
 * document cannot compile. They live here, in their own table, so the control
 * table stays a statement about controls. Both are non-empty strings, and both
 * are optional on a stored document: only an *add* requires them.
 */
export const COMPONENT_REF_PROPERTIES = ["componentCode", "componentVersion"] as const;

export type ComponentRefProperty = (typeof COMPONENT_REF_PROPERTIES)[number];

/** One editable property name, drawn from the table in the contract map. */
export type EditableProperty =
  | "title"
  | "description"
  | "required"
  | "readOnly"
  | "minLength"
  | "maxLength"
  | "pattern"
  | "minimum"
  | "maximum"
  | "multipleOf"
  | "decimalPlaces"
  | "allowMultiple"
  | "minItems"
  | "maxItems"
  | "options";

/** The wire kind of an editable property, so a setter can refuse a wrong value. */
export type EditablePropertyKind = "string" | "number" | "boolean" | "options";

export type EditablePropertyValue = string | number | boolean | readonly FieldOption[] | null;

const COMMON_PROPERTIES = ["title", "description", "required", "readOnly"] as const;

/**
 * The inspector table, transcribed from `odd/tasks/form-editor-contract.md`.
 *
 * The order is the document's order: the four properties common to every row,
 * then the row's own extras. `options` appears on `choice` alone because it is
 * the only type whose answer is a list; the contract's note that the key
 * "reaches every control" describes the control's prop bag, not a value a
 * non-choice row could carry.
 *
 * `component-ref` has no component selector here on purpose: the contract's
 * universe of wire keys (`FIELD_PROPERTY_KEYS`) has no key for it, so adding
 * one would be this module inventing a second vocabulary.
 */
export const EDITABLE_PROPERTIES: Readonly<Record<EditorFieldType, readonly EditableProperty[]>> =
  Object.freeze({
    text: [...COMMON_PROPERTIES, "minLength", "maxLength", "pattern"],
    textarea: [...COMMON_PROPERTIES, "minLength", "maxLength"],
    number: [...COMMON_PROPERTIES, "minimum", "maximum", "multipleOf", "decimalPlaces"],
    integer: [...COMMON_PROPERTIES, "minimum", "maximum", "multipleOf"],
    boolean: [...COMMON_PROPERTIES],
    date: [...COMMON_PROPERTIES],
    datetime: [...COMMON_PROPERTIES],
    time: [...COMMON_PROPERTIES],
    choice: [...COMMON_PROPERTIES, "allowMultiple", "options"],
    group: [...COMMON_PROPERTIES],
    repeater: [...COMMON_PROPERTIES, "minItems", "maxItems"],
    "component-ref": [...COMMON_PROPERTIES],
  });

const PROPERTY_KINDS: Readonly<Record<EditableProperty, EditablePropertyKind>> = Object.freeze({
  title: "string",
  description: "string",
  required: "boolean",
  readOnly: "boolean",
  minLength: "number",
  maxLength: "number",
  pattern: "string",
  minimum: "number",
  maximum: "number",
  multipleOf: "number",
  decimalPlaces: "number",
  allowMultiple: "boolean",
  minItems: "number",
  maxItems: "number",
  options: "options",
});

/** The property names a type's row of the table declares, in table order. */
export function editablePropertiesFor(type: EditorFieldType): readonly EditableProperty[] {
  return EDITABLE_PROPERTIES[type];
}

/** Whether `type` may carry `property`, without reading or writing anything. */
export function isEditableProperty(
  type: EditorFieldType,
  property: string,
): property is EditableProperty {
  return (EDITABLE_PROPERTIES[type] as readonly string[]).includes(property);
}

/** One node of the editable tree: a leaf field or a container. */
export interface EditorNode {
  readonly id: string;
  readonly code: string;
  readonly type: EditorFieldType;
  /** The live object from the form document. Edits write into it in place. */
  readonly raw: Record<string, unknown>;
  /** The raw object narrowed to the client's `Field` shape, for readers. */
  readonly field: Field;
  parent: EditorNode | null;
  children: EditorNode[];
}

/** The editable model over one version's documents. */
export interface DocumentModel {
  /** The parsed form document. Edits mutate it; nothing copies it. */
  readonly form: Record<string, unknown>;
  /** The parsed ui document, or `null` when the version had none. */
  readonly ui: Record<string, unknown> | null;
  /**
   * The parsed rules document, or `null` when the version had none.
   *
   * Not `readonly`, unlike the other two, and for one reason: a first rule
   * write on a version that carried no rules document has to be able to create
   * it. That is the same discipline as `childrenArray` and `rootArray` — a
   * container the model owns is created on first write — and a model that could
   * only read a rules document would be unable to author the first rule.
   */
  rules: Record<string, unknown> | null;
  /** Forwarded untouched; this piece does not author components. */
  readonly componentsJson: string | null;
  readonly root: EditorNode[];
  /**
   * Every node in the document, by field id.
   *
   * This is a **cache of the tree, with one writer**: {@link rebuildIndex}
   * fills it from `root` and the `children` lists, and every mutation ends by
   * calling it. Nothing else adds to it or takes from it.
   *
   * It used to be maintained incrementally, in four places — the parse walk,
   * `addField`, `detach` (which both remove and move share) and a repair loop
   * in `moveNode` that re-registered what a detach had taken out. That made the
   * tree and this index two independent records of the same fact, with nothing
   * saying they had to agree, and the repair loop failed *silently*: a subtree
   * whose walk missed a node left the index short by that node while the tree
   * kept it, so `nodeById` could not find a field the tree was still drawing.
   * One writer removes the class, not one instance of it.
   */
  readonly nodesById: Map<string, EditorNode>;
}

/**
 * Fill the id index from the tree, in full.
 *
 * The walk is over the tree and not over the document: the tree is what the
 * editor draws and what every caller iterates, so an index that disagrees with
 * it is the wrong one by definition. A repeated id means a mutation corrupted
 * the tree, and that is refused rather than collapsed — an index that quietly
 * lost one of two nodes with the same id is the failure this replaces.
 */
function rebuildIndex(model: DocumentModel): void {
  const walked = new Map<string, EditorNode>();
  for (const node of walkTree(model)) {
    if (walked.has(node.id)) {
      refuse(
        "INVALID_DOCUMENT",
        `The document holds two fields with id ${JSON.stringify(node.id)}; the id index cannot be built.`,
        node.id,
      );
    }
    walked.set(node.id, node);
  }
  model.nodesById.clear();
  for (const [id, node] of walked) {
    model.nodesById.set(id, node);
  }
}

/** The tree, in the one order the document means: root first, depth first. */
function* walkTree(model: DocumentModel): Generator<EditorNode> {
  for (const node of model.root) {
    yield node;
    yield* walkTreeFrom(node);
  }
}

function* walkTreeFrom(parent: EditorNode): Generator<EditorNode> {
  for (const child of parent.children) {
    yield child;
    yield* walkTreeFrom(child);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse one document, or `null` for a version that did not carry it.
 *
 * Absence is a real state on the wire and is carried as `null` rather than as
 * an empty document, so a load and a save of the same version cannot invent a
 * `{}` that was never stored.
 */
function parseDocument(
  text: string | null | undefined,
  label: string,
): Record<string, unknown> | null {
  if (text === null || text === undefined) {
    return null;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return refuse("INVALID_DOCUMENT", `${label} is not valid JSON: ${reason}`);
  }
  if (!isRecord(value)) {
    return refuse("INVALID_DOCUMENT", `${label} must be a JSON object.`);
  }
  return value;
}

function buildNode(
  raw: Record<string, unknown>,
  parent: EditorNode | null,
  seen: Set<string>,
  path: string,
): EditorNode {
  const declared = raw["type"];
  if (typeof declared !== "string" || !isEditorFieldType(declared)) {
    refuse(
      "INVALID_DOCUMENT",
      `${path} declares type ${JSON.stringify(declared)}, which is not one of the twelve editor types.`,
    );
  }
  const type = declared;
  const id = raw["id"];
  if (typeof id !== "string" || id.length === 0) {
    refuse("INVALID_DOCUMENT", `${path} has no id.`);
  }
  if (seen.has(id)) {
    refuse("INVALID_DOCUMENT", `${path} repeats the field id ${JSON.stringify(id)}.`, id);
  }
  seen.add(id);
  const code = raw["code"];
  const children: EditorNode[] = [];
  const node: EditorNode = {
    id,
    code: typeof code === "string" ? code : "",
    type,
    raw,
    field: raw as unknown as Field,
    parent,
    children,
  };
  const items = raw["items"];
  if (isContainerFieldType(type)) {
    if (items === undefined) {
      // A container with no `items` is an empty container, not a broken one.
    } else if (!Array.isArray(items)) {
      refuse("INVALID_DOCUMENT", `${path} has an items list that is not an array.`, id);
    } else {
      items.forEach((child, index) => {
        if (!isRecord(child)) {
          refuse("INVALID_DOCUMENT", `${path}/items/${index} is not a field object.`, id);
        }
        node.children.push(buildNode(child, node, seen, `${path}/items/${index}`));
      });
    }
  } else if (Array.isArray(items) && items.length > 0) {
    refuse("INVALID_DOCUMENT", `${path} is a ${type} and cannot have items.`, id);
  }
  return node;
}

/**
 * Parse a version's text into an editable model.
 *
 * This is the only place the model reads text. Everything after it works on
 * the parsed documents, and {@link serialiseDocuments} is the only place the
 * model produces text.
 *
 * Parsing is permissive about a `component-ref`'s `componentCode`: a stored
 * document is loaded and round-tripped as it is, whatever the core would make
 * of it, because a refusal here would be the editor refusing to open a
 * version. Only an *add* requires the component, where the model can still
 * refuse before the document is ever saved.
 */
export function parseDocuments(source: SourceDocuments): DocumentModel {
  if (typeof source.formSchemaJson !== "string" || source.formSchemaJson.trim().length === 0) {
    refuse("INVALID_DOCUMENT", "formSchemaJson is required and must be JSON text.");
  }
  const form = parseDocument(source.formSchemaJson, "formSchemaJson");
  if (form === null) {
    refuse("INVALID_DOCUMENT", "formSchemaJson is required and must be JSON text.");
  }
  const model: DocumentModel = {
    form,
    ui: parseDocument(source.uiSchemaJson ?? null, "uiSchemaJson"),
    rules: parseDocument(source.rulesSchemaJson ?? null, "rulesSchemaJson"),
    componentsJson: source.componentsJson ?? null,
    root: [],
    nodesById: new Map<string, EditorNode>(),
  };
  const fields = form["fields"];
  const seen = new Set<string>();
  if (fields === undefined) {
    // A form document with no field list is empty, not invalid.
  } else if (!Array.isArray(fields)) {
    refuse("INVALID_DOCUMENT", "formSchemaJson.fields must be an array.");
  } else {
    fields.forEach((entry, index) => {
      if (!isRecord(entry)) {
        refuse("INVALID_DOCUMENT", `formSchemaJson.fields/${index} is not a field object.`);
      }
      model.root.push(buildNode(entry, null, seen, `formSchemaJson.fields/${index}`));
    });
  }
  rebuildIndex(model);
  return model;
}

/**
 * The one serialisation.
 *
 * It exists because a version's stored text is the text the core hashed: parse
 * on load, edit the objects, and produce the stored text exactly once here, so
 * that what is saved, what is stored and what is hashed are the same bytes.
 * It is a pure projection of the current model — calling it mutates nothing —
 * and it is the only function in this module that calls `JSON.stringify`.
 * There is deliberately no "keep it fresh" serialisation: a per-keystroke
 * stringify would hand every layer a different string.
 */
export function serialiseDocuments(model: DocumentModel): EditorDocuments {
  return {
    formSchemaJson: stringify(model.form, "formSchemaJson"),
    uiSchemaJson: model.ui === null ? null : stringify(model.ui, "uiSchemaJson"),
    rulesSchemaJson: model.rules === null ? null : stringify(model.rules, "rulesSchemaJson"),
    componentsJson: model.componentsJson,
  };
}

function stringify(document: Record<string, unknown>, label: string): string {
  const text = JSON.stringify(document);
  if (typeof text !== "string") {
    return refuse("INVALID_DOCUMENT", `${label} could not be serialised as JSON.`);
  }
  return text;
}

function requireNode(model: DocumentModel, id: string): EditorNode {
  const node = model.nodesById.get(id);
  if (node === undefined) {
    return refuse("NODE_NOT_FOUND", `No field with id ${JSON.stringify(id)} in this document.`, id);
  }
  return node;
}

/** The array a container's children live in, created on first write. */
function childrenArray(node: EditorNode): unknown[] {
  const items = node.raw["items"];
  if (Array.isArray(items)) {
    return items;
  }
  const created: unknown[] = [];
  node.raw["items"] = created;
  return created;
}

/** The form document's own `fields` array, created on first write. */
function rootArray(model: DocumentModel): unknown[] {
  const fields = model.form["fields"];
  if (Array.isArray(fields)) {
    return fields;
  }
  const created: unknown[] = [];
  model.form["fields"] = created;
  return created;
}

/** The list a node's siblings live in: the root list or the parent's `items`. */
function siblingsOf(node: EditorNode | null, model: DocumentModel): unknown[] {
  return node === null ? rootArray(model) : childrenArray(node);
}

function childListOf(node: EditorNode | null, model: DocumentModel): EditorNode[] {
  return node === null ? model.root : node.children;
}

function slugSegment(value: string): string {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/**
 * A code no field in the document already uses.
 *
 * The generator never returns an existing code: the contract calls an
 * overwritten code silent data loss, so a collision walks forward instead.
 *
 * The codes come from the **tree**, not from the id index. The index is a cache
 * callers look ids up in; deciding a new field's identity from a cache would
 * make correctness depend on the cache being intact, which is the coupling the
 * rebuild exists to remove.
 */
function generateCode(model: DocumentModel, seed: string, type: EditorFieldType): string {
  const taken = new Set<string>();
  for (const node of walkTree(model)) {
    if (node.code.length > 0) {
      taken.add(node.code);
    }
  }
  const slug = slugSegment(seed);
  const base = slug.length > 0 ? slug : type;
  let candidate = base;
  let suffix = 1;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

function generateId(model: DocumentModel, code: string): string {
  let candidate = code;
  let suffix = 1;
  while (model.nodesById.has(candidate)) {
    suffix += 1;
    candidate = `${code}-${suffix}`;
  }
  return candidate;
}

/** Which component a `component-ref` node names, and at which version. */
export interface ComponentTarget {
  readonly componentCode: string;
  readonly componentVersion?: string;
}

/** Optional overrides for an added field. */
export interface AddFieldOptions {
  /** The id to use. Must be unique; a duplicate is refused. */
  readonly id?: string;
  /** The code to use. Must be unique; a duplicate is refused. */
  readonly code?: string;
  /** Seed for the generated code, and set as the field's `title`. */
  readonly label?: string;
  /**
   * The component a `component-ref` names. Required for that type, and
   * refused for every other type, which has no such key.
   */
  readonly component?: ComponentTarget;
  /** Where to insert among the new parent's children. Appends when omitted. */
  readonly index?: number;
}

/**
 * Where a node may go, and why. One rule, stated once:
 *
 * - a node may go under the root, under a `group` or a `component-ref`, or
 *   under a `repeater` **if it is a leaf**;
 * - a container may not go under a `repeater`, because a repeater's children
 *   are per-row answer fields and a container has no place in one row;
 * - a `component-ref` may not go under a `component-ref`, because expansion
 *   would be recursive.
 *
 * It is a rule about a node and a **type**, and never about the node's
 * contents: an empty repeater takes a leaf exactly as a repeater with rows
 * does, so nothing here reads `children`.
 *
 * A move adds one more rule, which is not in this function because it is about
 * a node's position rather than a pair of types: a node may not go inside its
 * own subtree.
 *
 * The rule is written as a *question* -- the refusal, or `null` -- and the
 * mutations below are the ones that turn it into an exception. That is what lets
 * {@link canReceiveChild} answer for a caller that has to decide whether to
 * *aim* somewhere without a second copy of the rules drifting beside it.
 */
function placementRefusal(
  type: EditorFieldType,
  parent: EditorNode | null,
): EditorModelError | null {
  if (parent === null) {
    return null;
  }
  if (!isContainerFieldType(parent.type)) {
    return new EditorModelError(
      "ILLEGAL_PLACEMENT",
      `${parent.type} ${JSON.stringify(parent.id)} is a field, not a container, so nothing can go inside it.`,
      parent.id,
    );
  }
  if (parent.type === "repeater" && isContainerFieldType(type)) {
    return new EditorModelError(
      "ILLEGAL_PLACEMENT",
      `A repeater's children are per-row answer fields, so a ${type} may not go under ${JSON.stringify(parent.id)}.`,
      parent.id,
    );
  }
  if (parent.type === "component-ref" && type === "component-ref") {
    return new EditorModelError(
      "ILLEGAL_PLACEMENT",
      `A component reference may not contain another component reference: ${JSON.stringify(parent.id)}.`,
      parent.id,
    );
  }
  return null;
}

/** The mutation half of {@link placementRefusal}: the same answer, thrown. */
function assertPlacement(type: EditorFieldType, parent: EditorNode | null): void {
  const refusal = placementRefusal(type, parent);
  if (refusal !== null) {
    throw refusal;
  }
}

/**
 * Whether `nodeId` may receive a node of `draggedType` right now.
 *
 * The question a layer asks *before* it writes: the drag layer resolves a band
 * into a position, and asking this first is what keeps it from aiming
 * somewhere the model will always refuse. It delegates to the same
 * {@link placementRefusal} `addField` and `moveNode` answer with, so the two
 * cannot disagree: there is one rule, and this is the question form of it.
 *
 * A node that is not in the document receives nothing, and neither does a
 * dragged type that is not one of the twelve -- there is no such placement, so
 * the honest answer to "may this go here?" is no rather than a guess.
 */
export function canReceiveChild(
  model: DocumentModel,
  nodeId: string,
  draggedType: string,
): boolean {
  const parent = model.nodesById.get(nodeId);
  if (parent === undefined || !isEditorFieldType(draggedType)) {
    return false;
  }
  return placementRefusal(draggedType, parent) === null;
}

/**
 * Add a field or a container.
 *
 * The id and the code are generated, and the code generator walks past every
 * code already in the document, so an add never overwrites an existing code. A
 * type outside the twelve is refused, and so is a placement the rules above
 * disallow.
 */
export function addField(
  model: DocumentModel,
  type: string,
  parentId: string | null = null,
  options: AddFieldOptions = {},
): EditorNode {
  if (!isEditorFieldType(type)) {
    refuse("UNKNOWN_FIELD_TYPE", `${JSON.stringify(type)} is not one of the twelve editor types.`);
  }
  const parent = parentId === null ? null : requireNode(model, parentId);
  assertPlacement(type, parent);
  const label = options.label ?? "";
  const code = options.code ?? generateCode(model, label.length > 0 ? label : type, type);
  const id = options.id ?? generateId(model, code);
  for (const node of walkTree(model)) {
    if (node.id === id) {
      refuse("DUPLICATE_ID", `A field with id ${JSON.stringify(id)} already exists.`, id);
    }
  }
  if (code.length > 0) {
    for (const node of walkTree(model)) {
      if (node.code === code) {
        refuse("DUPLICATE_CODE", `A field with code ${JSON.stringify(code)} already exists.`, id);
      }
    }
  }
  const raw: Record<string, unknown> = { id, code, type };
  if (type === "component-ref") {
    // A component reference is created with its component or not at all.
    //
    // The palette is what knows which components a form may reference, so the
    // component travels with the add rather than being typed in afterwards. A
    // `component-ref` created without one would be a structurally valid node
    // that names nothing: the core cannot expand it, so the document cannot
    // compile, and the defect would surface as a compile error on save instead
    // of as a refusal at the moment of the add. Refusing here is the loud
    // failure. `componentVersion` is written when given, because only the code
    // is what expansion needs.
    const target = options.component;
    if (target === undefined || target.componentCode.length === 0) {
      refuse(
        "MISSING_COMPONENT_REFERENCE",
        `A component-ref must name a component. Pass options.component when adding ${JSON.stringify(type)}.`,
        id,
      );
    }
    raw["componentCode"] = target.componentCode;
    if (target.componentVersion !== undefined) {
      raw["componentVersion"] = target.componentVersion;
    }
  } else if (options.component !== undefined) {
    refuse("PROPERTY_NOT_EDITABLE", `A ${type} has no componentCode to set.`, id);
  }
  if (label.length > 0) {
    raw["title"] = label;
  }
  const siblings = childListOf(parent, model);
  const index = options.index ?? siblings.length;
  if (index !== undefined && (!Number.isInteger(index) || index < 0 || index > siblings.length)) {
    refuse("ILLEGAL_INDEX", `Index ${String(options.index)} is outside 0..${siblings.length}.`, id);
  }
  const node: EditorNode = {
    id,
    code,
    type,
    raw,
    field: raw as unknown as Field,
    parent,
    children: [],
  };
  siblingsOf(parent, model).splice(index, 0, raw);
  siblings.splice(index, 0, node);
  // The index is filled here and nowhere else in this function: the tree is
  // the fact, and the index is what callers read to find a node in it.
  rebuildIndex(model);
  return node;
}

function collectSelfAndDescendants(node: EditorNode): string[] {
  const ids = [node.id];
  for (const child of node.children) {
    ids.push(...collectSelfAndDescendants(child));
  }
  return ids;
}

/** Every id a subtree owns. Used by callers, and by the tests below. */
export function subtreeIds(node: EditorNode): readonly string[] {
  return collectSelfAndDescendants(node);
}

/**
 * Unlink a node from its parent's list, structurally only.
 *
 * Nothing here touches the id index. `detach` is shared by remove and move, and
 * a shared function that both removed and repaired index entries was a place
 * where the two could disagree about what the subtree still is. The index is
 * rebuilt by the caller, once, from the tree this leaves behind.
 */
function detach(model: DocumentModel, node: EditorNode): void {
  const siblings = childListOf(node.parent, model);
  const at = siblings.indexOf(node);
  if (at >= 0) {
    siblings.splice(at, 1);
  }
  const list = siblingsOf(node.parent, model);
  const rawAt = list.indexOf(node.raw);
  if (rawAt >= 0) {
    list.splice(rawAt, 1);
  }
}

/**
 * Remove a node and its whole subtree.
 *
 * The ui and rules documents are left alone. A ui entry or a rule for a field
 * that no longer exists is inert, and this piece is not the rule builder, so
 * deleting a rule the user wrote would be a loss the model cannot undo.
 */
export function removeNode(model: DocumentModel, id: string): void {
  detach(model, requireNode(model, id));
  // The removed subtree leaves the index because it left the tree, and for no
  // other reason: nothing had to remember to drop it.
  rebuildIndex(model);
}

function isDescendantOf(node: EditorNode, candidate: EditorNode): boolean {
  for (const child of node.children) {
    if (child === candidate || isDescendantOf(child, candidate)) {
      return true;
    }
  }
  return false;
}

/**
 * Move a node to a new parent and index.
 *
 * Refused, with a code, when: the new parent is inside the node's own subtree
 * (the container-inside-itself case), the new parent is not a container, the
 * placement violates the repeater or component-reference rules above, or the
 * index is outside the new sibling list. A move within one parent counts the
 * node's old position as already taken when the index is measured after the
 * removal, so moving a node onto itself is `index + 1` rather than `index`.
 */
export function moveNode(
  model: DocumentModel,
  id: string,
  newParentId: string | null,
  index: number,
): EditorNode {
  const node = requireNode(model, id);
  const parent = newParentId === null ? null : requireNode(model, newParentId);
  if (parent !== null && (parent === node || isDescendantOf(node, parent))) {
    refuse("ILLEGAL_MOVE", `${JSON.stringify(id)} cannot move inside its own subtree.`, id);
  }
  assertPlacement(node.type, parent);
  const from = node.parent;
  const fromSiblings = childListOf(from, model);
  const fromIndex = fromSiblings.indexOf(node);
  if (fromIndex < 0) {
    refuse("ILLEGAL_MOVE", `${JSON.stringify(id)} is not in its parent's child list.`, id);
  }
  const limit = from === parent ? fromSiblings.length - 1 : childListOf(parent, model).length;
  if (!Number.isInteger(index) || index < 0 || index > limit) {
    refuse("ILLEGAL_INDEX", `Index ${String(index)} is outside 0..${limit}.`, id);
  }
  detach(model, node);
  node.parent = parent;
  siblingsOf(parent, model).splice(index, 0, node.raw);
  childListOf(parent, model).splice(index, 0, node);
  // A move changes a position, never an identity, so the moved subtree is
  // re-registered under the same ids by the same rebuild that registers the
  // siblings the move left where they were. There is no repair loop: a subtree
  // that this failed to put back would be a node in no list at all, and the
  // rebuild would not see it to index it.
  rebuildIndex(model);
  return node;
}

/** Read one editable property, from the document the property lives in. */
export function getNodeProperty(
  node: EditorNode,
  property: EditableProperty,
): EditablePropertyValue {
  const value = node.raw[property];
  if (value === undefined) {
    return property === "options" ? [] : null;
  }
  if (property === "options") {
    return Array.isArray(value) ? (value as FieldOption[]) : [];
  }
  return value as string | number | boolean;
}

/**
 * Write one editable property into the form document.
 *
 * A property the type's row does not declare is refused, not stored: a
 * silently stored `minLength` on a `boolean` is a document the core will not
 * read and the editor would keep showing. A `null` value removes the key.
 */
export function setNodeProperty(
  node: EditorNode,
  property: EditableProperty,
  value: EditablePropertyValue,
): void {
  if (!isEditableProperty(node.type, property)) {
    refuse("PROPERTY_NOT_EDITABLE", `A ${node.type} has no ${property} to edit.`, node.id);
  }
  if (value === null) {
    delete node.raw[property];
    return;
  }
  const kind = PROPERTY_KINDS[property];
  if (kind === "options") {
    if (!Array.isArray(value)) {
      refuse("INVALID_PROPERTY_VALUE", `${property} takes a list of options.`, node.id);
    }
    node.raw[property] = value.map((option) => ({ ...option }));
    return;
  }
  if (kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      refuse("INVALID_PROPERTY_VALUE", `${property} takes a finite number.`, node.id);
    }
    node.raw[property] = value;
    return;
  }
  if (typeof value !== kind) {
    refuse("INVALID_PROPERTY_VALUE", `${property} takes a ${kind}.`, node.id);
  }
  node.raw[property] = value;
}

/** Read a `component-ref` document property: `componentCode`, `componentVersion`. */
export function getComponentRefProperty(
  node: EditorNode,
  property: ComponentRefProperty,
): string | null {
  if (node.type !== "component-ref") {
    refuse(
      "PROPERTY_NOT_EDITABLE",
      `A ${node.type} is not a component reference and has no ${property}.`,
      node.id,
    );
  }
  const value = node.raw[property];
  return typeof value === "string" ? value : null;
}

/**
 * Write a `component-ref` document property.
 *
 * Refused for any other type, exactly as a control property is: a
 * `componentCode` on a `text` is a key the core will not read and the editor
 * would keep showing. An empty or non-string value is refused too, because
 * clearing `componentCode` turns a compilable node into a dead one, and that is
 * a decision to make deliberately rather than a keystroke to undo.
 */
export function setComponentRefProperty(
  node: EditorNode,
  property: ComponentRefProperty,
  value: string,
): void {
  if (node.type !== "component-ref") {
    refuse(
      "PROPERTY_NOT_EDITABLE",
      `A ${node.type} is not a component reference and has no ${property}.`,
      node.id,
    );
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    refuse(
      "INVALID_PROPERTY_VALUE",
      `${property} must be a non-empty string; a component reference with an empty ${property} names nothing.`,
      node.id,
    );
  }
  node.raw[property] = value;
}

/** The component a `component-ref` names, or `null` when it names none. */
export function componentTargetFor(node: EditorNode): ComponentTarget | null {
  if (node.type !== "component-ref") {
    return null;
  }
  const componentCode = getComponentRefProperty(node, "componentCode");
  if (componentCode === null) {
    return null;
  }
  const componentVersion = getComponentRefProperty(node, "componentVersion");
  return componentVersion === null ? { componentCode } : { componentCode, componentVersion };
}

/**
 * The ui entry for a field, keyed by field id: the one convention the core
 * reads. Returns `null` for a field with no entry, and creates nothing.
 */
export function uiEntryFor(model: DocumentModel, id: string): Record<string, unknown> | null {
  requireNode(model, id);
  if (model.ui === null) {
    return null;
  }
  const fields = model.ui["fields"];
  if (!isRecord(fields)) {
    return null;
  }
  const entry = fields[id];
  return isRecord(entry) ? entry : null;
}

/**
 * The rules entry for a field, keyed by field id. Creates nothing, and returns
 * `null` for a field the rules document does not mention.
 */
export function rulesEntryFor(model: DocumentModel, id: string): Record<string, unknown> | null {
  requireNode(model, id);
  if (model.rules === null) {
    return null;
  }
  const fields = model.rules["fields"];
  if (!isRecord(fields)) {
    return null;
  }
  const entry = fields[id];
  return isRecord(entry) ? entry : null;
}

/** Every field code in the document, in document order, depth first. */
export function fieldCodes(model: DocumentModel): string[] {
  const codes: string[] = [];
  for (const node of walkTree(model)) {
    if (node.code.length > 0) {
      codes.push(node.code);
    }
  }
  return codes;
}

/** The codes a `ref` may name, as the set the builder resolves against. */
export function knownCodeSet(model: DocumentModel): Set<string> {
  return new Set(fieldCodes(model));
}

/**
 * The four keys a field's rules carry, and only those.
 *
 * `FieldRules` in `packages/colander-client/src/types.ts` has exactly four. An
 * earlier draft of the contract map listed a fifth; that was the map's error,
 * so this list is closed at four and a key outside it cannot be written from
 * here. The keys are not invented in this module: they come from `rules.ts`,
 * which carries what each one *means* alongside the name.
 */
export { CONDITION_RULE_KEYS, FIELD_RULE_KEYS, FIELD_RULE_ROWS, isFieldRuleKey } from "./rules";
export type { FieldRuleKey, FieldRuleRow } from "./rules";

/**
 * The live rules entry for a field, created on first write.
 *
 * The rules document and its `fields` map are the model's to own, and they are
 * created the way `childrenArray` and `rootArray` create theirs: a version
 * that carried no rules document and an author who has just written a rule is
 * an author asking for a rules document, not an editor inventing one. The
 * creation happens on a *write* only — a read never creates, so opening a
 * version and looking at it cannot change what a save would store.
 */
function mutableRulesEntry(model: DocumentModel, fieldId: string): Record<string, unknown> {
  if (model.rules === null) {
    model.rules = {};
  }
  const fields = model.rules["fields"];
  if (!isRecord(fields)) {
    const created: Record<string, unknown> = {};
    model.rules["fields"] = created;
  }
  const writable = model.rules["fields"] as Record<string, unknown>;
  const existing = writable[fieldId];
  if (isRecord(existing)) {
    return existing;
  }
  const created: Record<string, unknown> = {};
  writable[fieldId] = created;
  return created;
}

/**
 * Read one of a field's four rule keys.
 *
 * Returns the **live** expression object out of the parsed rules document, not
 * a copy, so a builder can edit it through `rules.ts` and the edit lands in the
 * document the one serialisation will produce. `null` means the key is absent,
 * which the contract allows and which is not the same as a stored `null`: a
 * stored `null` reads back as `null` here and is left where it is.
 *
 * A stored value that is not an expression at all is **read permissively**,
 * because refusing to open a version is worse than showing it. It comes back as
 * `null` and {@link fieldRuleProblems} says why.
 */
export function getFieldRule(
  model: DocumentModel,
  id: string,
  key: FieldRuleKey,
): ExpressionNode | null {
  const entry = rulesEntryFor(model, id);
  if (entry === null) {
    return null;
  }
  const value = entry[key];
  if (!isRecord(value)) {
    return null;
  }
  return value;
}

/**
 * Write one of a field's four rule keys, or remove it.
 *
 * The write goes into the live entry, so a key of that entry the editor does
 * not model — and there can be one, since `FieldRules` is the contract's shape
 * and not the document's only contents — survives untouched. `null` **removes**
 * the key rather than writing `null`: the contract allows absence, and a
 * document that grows `null` where it used to be absent is a different
 * document for no reason.
 *
 * An expression is checked before it is written, and the check is the one in
 * `rules.ts`: structure, and every `ref` against the codes the document
 * actually has. A stored reference to a code that is gone is **not** rewritten
 * — the model has no business deciding an author meant a different field — but
 * a *new* one cannot be created, because that is the builder inventing a
 * reference to nothing.
 */
export function setFieldRule(
  model: DocumentModel,
  fieldId: string,
  key: FieldRuleKey,
  expression: ExpressionNode | null,
): void {
  requireNode(model, fieldId);
  if (expression === null) {
    // A removal with no rules document is a no-op, not a document creation.
    if (model.rules === null) {
      return;
    }
    const entry = rulesEntryFor(model, fieldId);
    if (entry === null) {
      return;
    }
    delete entry[key];
    return;
  }
  try {
    assertExpression(expression, { isKnownCode: (code) => knownCodeSet(model).has(code) });
  } catch (error) {
    if (!(error instanceof RulesError)) {
      throw error;
    }
    refuse(error.code, error.message, fieldId);
  }
  mutableRulesEntry(model, fieldId)[key] = expression;
}

/** One rule key of one field, with what the document holds for it. */
export interface FieldRuleRowState {
  readonly key: FieldRuleKey;
  readonly label: string;
  readonly meaning: string;
  /** `condition` for the three `…When` keys, `value` for `calculate`. */
  readonly kind: "condition" | "value";
  /** The live expression, or `null` when the key is absent. */
  readonly expression: ExpressionNode | null;
}

/**
 * All four keys of one field's rules, in the contract's order.
 *
 * The order is fixed by `rules.ts` and is the client's `FieldRules` order, so
 * a builder that maps over this draws the four keys the same way every time
 * and cannot omit one. A key with no expression comes back with `null` rather
 * than being left out: "this field has no `requiredWhen`" is a fact the author
 * needs to see, and a missing row is not that fact.
 */
export function fieldRulesFor(model: DocumentModel, id: string): FieldRuleRowState[] {
  return FIELD_RULE_ROWS.map((row) => ({
    key: row.key,
    label: row.label,
    meaning: row.meaning,
    kind: row.kind,
    expression: getFieldRule(model, id, row.key),
  }));
}

/** One thing wrong with the rules document, as a sentence to draw. */
export interface FieldRuleProblem {
  readonly fieldId: string;
  readonly key: string;
  readonly message: string;
}

/**
 * Everything about the rules document that is worth telling the author.
 *
 * Two facts are reported and neither is repaired:
 *
 * - an **orphan**: a rules entry for a field the form document no longer has.
 *   `removeNode` deliberately leaves rules alone, so this is the expected state
 *   of a rule whose field was deleted, and the author is the only one who can
 *   say whether to delete the rule or put the field back.
 * - a **bad value**: a stored rule key whose value is not an expression the
 *   contract describes. Refusing to open the version would be worse, so it is
 *   shown.
 */
export function fieldRuleProblems(model: DocumentModel): FieldRuleProblem[] {
  const problems: FieldRuleProblem[] = [];
  if (model.rules === null) {
    return problems;
  }
  const fields = model.rules["fields"];
  if (!isRecord(fields)) {
    return problems;
  }
  for (const [fieldId, entry] of Object.entries(fields)) {
    if (!isRecord(entry)) {
      continue;
    }
    for (const [key, value] of Object.entries(entry)) {
      if (value === null || value === undefined) {
        continue;
      }
      try {
        assertExpression(value);
      } catch (error) {
        problems.push({
          fieldId,
          key,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return problems;
}

/**
 * The rules entries whose field the form document does not have.
 *
 * This is the orphan list, and it is derived rather than stored: a rule becomes
 * orphaned when a field is removed, and nothing records that moment, so the
 * fact is read from the two documents agreeing. The entries themselves are
 * **kept** — a rule the author wrote is not the editor's to throw away.
 */
export function orphanedRuleFields(model: DocumentModel): string[] {
  if (model.rules === null) {
    return [];
  }
  const fields = model.rules["fields"];
  if (!isRecord(fields)) {
    return [];
  }
  return Object.keys(fields).filter((fieldId) => model.nodesById.get(fieldId) === undefined);
}

/** The `hidden` flag the core reads from `ui.fields[id]`, or `false`. */
export function isHiddenInUi(model: DocumentModel, id: string): boolean {
  return uiEntryFor(model, id)?.["hidden"] === true;
}

/** Every field id in the document, in document order, depth first. */
export function fieldIds(model: DocumentModel): string[] {
  return Array.from(walkTree(model), (node) => node.id);
}

/** The node a field id names, or `null` for a field the document does not have. */
export function nodeById(model: DocumentModel, id: string): EditorNode | null {
  return model.nodesById.get(id) ?? null;
}

/** The types the palette may offer, in the core's own order. */
export function palette(): readonly ColanderFieldType[] {
  return EDITOR_FIELD_TYPES;
}
