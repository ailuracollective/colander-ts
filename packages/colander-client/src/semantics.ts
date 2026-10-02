import type { ColanderFieldType, Field } from "./types.js";

export type { FieldOption } from "./types.js";

/**
 * What the core knows about every field type, stated as data.
 *
 * This table is the core's declaration of what a type *means*: the wire keys a
 * field of that type may carry, the shape of its answer, and whether the type is
 * something a control can be generated for at all. It is deliberately silent
 * about how any of that is drawn.
 *
 * The boundary is the point of the module. A reader that knows only this table
 * can write a component generator that is correct for every consumer, and no
 * entry below may name a component, a framework, a markup element, or a
 * styling concern. The moment one does, the table stops being the core's
 * semantics and becomes one library's design decisions.
 *
 * `text` and `textarea` stay separate types even though their property lists
 * overlap, because the core treats them as separate types: a consumer is free to
 * materialise the same semantic type as two different controls, and that choice
 * belongs to the consumer, not here.
 */

/** The TypeScript type of one semantic property's value. */
export type SemanticPropertyType = "string" | "number" | "boolean";

/**
 * How a type's answer is shaped where a control is bound to it.
 *
 * This is what lets a generated control type its own value and change handler
 * without knowing anything about the answer beyond its shape. A container's
 * value is a structure rather than a scalar; it is declared as a string purely
 * so the descriptor is total, and no control is ever generated for it.
 *
 * **`"string-or-string-list"` is the one kind that is a union, and it exists
 * because a `choice`'s answer shape is not a property of its *type*.** The core
 * decides it per *field*, from `allowMultiple`, and it decides it strictly in
 * both directions — `convert_single_choice` takes `Json::as_str` and
 * `convert_multi_choice` takes `Json::Array`, each returning a type error for
 * the other's shape. A kind name can therefore only describe a choice honestly
 * by naming both shapes; a descriptor that said `"string-list"` claimed the core
 * accepts a list for every choice, and that claim is false for exactly the
 * single-select case the type is most often used for.
 *
 * `"string-list"` is kept rather than removed. No descriptor declares it today,
 * but it is a true statement about a shape, `ControlValue`/`ControlChange` are
 * published generics keyed by these names, and retiring a name the core's table
 * never contradicted is a break this change does not need to make. What changed
 * is that the `choice` descriptor no longer claims it.
 */
export type SemanticValueKind =
  | "string"
  | "number"
  | "boolean"
  | "string-list"
  | "string-or-string-list";

/** The wire keys on `Field` that a generated control may forward to its consumer. */
export const FIELD_PROPERTY_KEYS = [
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "multipleOf",
  "decimalPlaces",
  "allowMultiple",
  "minItems",
  "maxItems",
  "title",
  "description",
] as const;

/** One of the wire keys a semantic property may be named after. */
export type FieldPropertyKey = (typeof FIELD_PROPERTY_KEYS)[number];

/**
 * What `Field` says a key's value is, with `undefined` removed.
 *
 * `Field` carries an index signature, so `keyof Field` is `string | number` and
 * cannot prove that a named key exists: every key, declared or not, resolves
 * through the index signature. Reading the value type instead recovers what the
 * index signature hides, because a declared property wins over the signature and
 * a name that was never declared degrades to `unknown`.
 */
type FieldPropertyType<K extends string> = Exclude<
  K extends keyof Field ? Field[K] : unknown,
  undefined
>;

/** The name of the primitive a derived value type is, or `never` if it is none. */
type PrimitiveName<T> = T extends string
  ? "string"
  : T extends number
    ? "number"
    : T extends boolean
      ? "boolean"
      : never;

/** One semantic property a type carries. `name` is the wire key on `Field`. */
export interface SemanticProperty {
  readonly name: FieldPropertyKey;
  readonly type: SemanticPropertyType;
}

/** Everything the core knows about one field type. */
export interface SemanticTypeDescriptor {
  readonly type: ColanderFieldType;
  /** `false` for a container: a group, a repeater, or a component reference. */
  readonly materializable: boolean;
  readonly value: SemanticValueKind;
  /** Always includes `title` and `description`, plus the type's own constraint keys. */
  readonly properties: readonly SemanticProperty[];
  /**
   * Whether the field property that decides the answer's shape is `allowMultiple`.
   *
   * The type alone cannot say how a choice's answer is shaped, so a control for
   * it has to read that property and narrow on it. Every other type's answer
   * shape follows from the type, and says so here by being absent.
   */
  readonly shapeFromProperty?: "allowMultiple";
}

/** The types that hold other fields instead of holding an answer directly. */
export const CONTAINER_FIELD_TYPES = ["group", "repeater", "component-ref"] as const;

/** One of the types that is not a container. */
export type MaterializableFieldType = Exclude<
  ColanderFieldType,
  "group" | "repeater" | "component-ref"
>;

/** Every field type, with the properties it carries, in the core's own order. */
export const SEMANTIC_TYPE_DESCRIPTORS = [
  {
    materializable: true,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "minLength", type: "number" },
      { name: "maxLength", type: "number" },
      { name: "pattern", type: "string" },
    ],
    type: "text",
    value: "string",
  },
  {
    materializable: true,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "minLength", type: "number" },
      { name: "maxLength", type: "number" },
    ],
    type: "textarea",
    value: "string",
  },
  {
    materializable: true,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "minimum", type: "number" },
      { name: "maximum", type: "number" },
      { name: "multipleOf", type: "number" },
      { name: "decimalPlaces", type: "number" },
    ],
    type: "number",
    value: "number",
  },
  {
    materializable: true,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "minimum", type: "number" },
      { name: "maximum", type: "number" },
      { name: "multipleOf", type: "number" },
    ],
    type: "integer",
    value: "number",
  },
  {
    materializable: true,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
    ],
    type: "boolean",
    value: "boolean",
  },
  {
    materializable: true,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
    ],
    type: "date",
    value: "string",
  },
  {
    materializable: true,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
    ],
    type: "datetime",
    value: "string",
  },
  {
    materializable: true,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
    ],
    type: "time",
    value: "string",
  },
  {
    materializable: true,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "allowMultiple", type: "boolean" },
    ],
    shapeFromProperty: "allowMultiple",
    type: "choice",
    value: "string-or-string-list",
  },
  {
    materializable: false,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
    ],
    type: "group",
    value: "string",
  },
  {
    materializable: false,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "minItems", type: "number" },
      { name: "maxItems", type: "number" },
    ],
    type: "repeater",
    value: "string",
  },
  {
    materializable: false,
    properties: [
      { name: "title", type: "string" },
      { name: "description", type: "string" },
    ],
    type: "component-ref",
    value: "string",
  },
] as const satisfies readonly SemanticTypeDescriptor[];

/**
 * The declared `type` of every property, checked against `Field` itself.
 *
 * The table above is data, so nothing in the type system would stop it from
 * claiming a key `Field` does not declare or declaring a `number` key as a
 * `string`. This is where that is caught: each property is read back through
 * `Field`, and a property whose declared type disagrees with the wire type — or
 * whose name is not a declared key at all, which reads as `unknown` and so has
 * no primitive name — becomes part of {@link SEMANTIC_PROPERTY_TYPE_MISMATCHES}.
 *
 * A mismatch is a compile error naming the offending property, in this package,
 * before any consumer is involved.
 */
type UnverifiedProperty = (typeof SEMANTIC_TYPE_DESCRIPTORS)[number]["properties"][number];

/** A property whose declared type or name disagrees with `Field`. */
type PropertyMismatch<T extends UnverifiedProperty> = T extends { name: infer Name extends string }
  ? PrimitiveName<FieldPropertyType<Name>> extends never
    ? T
    : PrimitiveName<FieldPropertyType<Name>> extends T["type"]
      ? never
      : T
  : never;

/** Every property in {@link SEMANTIC_TYPE_DESCRIPTORS} that `Field` does not back. */
export type SEMANTIC_PROPERTY_TYPE_MISMATCHES = PropertyMismatch<UnverifiedProperty>;

/**
 * Compiles only when no declared property disagrees with `Field`.
 *
 * The declaration is load-bearing and is not exported: it exists so the check
 * below is a compile error rather than a comment. Naming it makes an unused
 * private symbol appear in the emitted declarations.
 */
const semanticsMatchTheWireModel: [SEMANTIC_PROPERTY_TYPE_MISMATCHES] extends [never]
  ? true
  : SEMANTIC_PROPERTY_TYPE_MISMATCHES = true;
void semanticsMatchTheWireModel;

/**
 * The core's descriptor for one field type.
 *
 * The match is exact and case-sensitive, and an unknown type is `null` rather
 * than a guess: a compiled form cannot carry one, so a `null` here means a
 * hand-authored document reached a component generator, and silently defaulting
 * it would hide exactly that.
 *
 * @param type the declared type of a field
 * @returns the descriptor, or `null` when the type is not one of the core's
 */
export function semanticDescriptorFor(type: string): SemanticTypeDescriptor | null {
  const found = SEMANTIC_TYPE_DESCRIPTORS.find((entry) => entry.type === type);
  return found ?? null;
}

/**
 * Every type a control can be generated for, in the core's own order.
 *
 * @returns the types that hold an answer directly rather than other fields
 */
export function materializableTypes(): readonly MaterializableFieldType[] {
  return SEMANTIC_TYPE_DESCRIPTORS.filter(
    (
      entry,
    ): entry is (typeof SEMANTIC_TYPE_DESCRIPTORS)[number] & { readonly materializable: true } =>
      entry.materializable,
  ).map((entry) => entry.type);
}
