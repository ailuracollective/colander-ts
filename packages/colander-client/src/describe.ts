import type { RuleState } from "./apply-rules.js";
import type { FormDefinition, LeafNode } from "./form-definition.js";
import { resolveFieldForPath } from "./form-definition.js";
import type { SemanticTypeDescriptor } from "./semantics.js";
import { semanticDescriptorFor } from "./semantics.js";
import type { Field, ResponseError } from "./types.js";

/**
 * The runtime control descriptor: what a renderer needs to draw one field.
 *
 * Everything here is per field *instance* and *now*: the answer the person
 * typed, the flags after rules, the errors the last validation returned. The
 * compiler's generated controls are static per type, which is why a renderer
 * otherwise re-derives all of this itself, once per project.
 *
 * The module draws nothing. It states what a field is, so that two renderers
 * reading the same form agree about it, and a renderer can stay a renderer.
 */

/** One error attached to one field. The core's `ResponseError`, unchanged. */
export interface FieldError {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

/** One choice, normalized, with its selection resolved against the value. */
export interface ControlOption {
  readonly value: string;
  readonly label: string;
  readonly selected: boolean;
}

/**
 * The constraints the core's own semantic table says this type carries.
 *
 * The keys are the wire names on `Field` — `minimum`, not `min` — because the
 * wire keys are the contract: a descriptor that renamed them would need a
 * translation nobody asked for, and the two spellings would drift.
 */
export interface ControlConstraints {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly multipleOf?: number;
  readonly decimalPlaces?: number;
}

/** The effective flags for this field, after rules and after inheritance. */
export interface ControlState {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly required: boolean;
  readonly readOnly: boolean;
}

/** Everything one renderer needs to draw and validate one field. */
export interface ControlDescriptor {
  readonly id: string;
  readonly code: string;
  /** JSON pointer into the form schema — the string an error path points at. */
  readonly pointer: string;
  /**
   * The declared type, as a plain string.
   *
   * Not a closed union: `FieldType` is `ColanderFieldType | (string & {})` and a
   * document the caller compiled by hand can carry anything.
   */
  readonly type: string;
  readonly label: string;
  readonly description?: string;
  readonly value: unknown;
  readonly options: readonly ControlOption[];
  readonly constraints: ControlConstraints;
  readonly state: ControlState;
  readonly errors: readonly FieldError[];
  /**
   * `describedBy` points at the field id, which is where the renderer was told
   * to put a description; it names nothing the renderer has not been handed.
   */
  readonly aria: { readonly describedBy?: string; readonly invalid: boolean };
}

/** An answer key the form does not declare, or one no field could claim. */
export const ANSWERS_ERROR_KEY = "__answers__";

/** A `/rules/validations` failure: cross-field, and owned by no single field. */
export const RULES_ERROR_KEY = "__rules__";

/** A path that resolved to nothing at all. */
export const UNRESOLVED_ERROR_KEY = "__unresolved__";

/**
 * The bucket one error path belongs to.
 *
 * The `answers` case is the one that needs care: `/answers/<code>` names an
 * answer, and an answer the form declares *is* a field, so a resolvable code
 * keys by that field's id. Only a code no field claims is the reserved answers
 * bucket. A `field` resolution with no id is the same situation — there is no
 * field to blame, so it joins the unresolved bucket rather than the empty key.
 *
 * @param {FormDefinition} definition the index every path is resolved against
 * @param {string} path one `ResponseError.path`
 * @returns {string} the field id, or the reserved bucket this error belongs in
 */
function keyForError(definition: FormDefinition, path: string): string {
  const resolved = resolveFieldForPath(definition, path);
  if (resolved === null) {
    return UNRESOLVED_ERROR_KEY;
  }
  if (resolved.kind === "rules") {
    return RULES_ERROR_KEY;
  }
  if (resolved.id.length > 0) {
    return resolved.id;
  }
  return resolved.kind === "answers" ? ANSWERS_ERROR_KEY : UNRESOLVED_ERROR_KEY;
}

/**
 * Map a validated response's errors onto field ids.
 *
 * Nothing is dropped. An error that resolves to a field keys by that field's
 * id; an `/answers/<code>` error whose code names a field keys by that field
 * too, because the field *is* what failed; everything else — an unknown answer
 * key, `/rules/validations`, a path that resolves to nothing — lands under an
 * exported reserved key. A cross-field error that vanished would leave the form
 * looking valid when it is not.
 *
 * @param {FormDefinition} definition the compiled form the error paths point into
 * @param {readonly ResponseError[]} errors every error the validation returned
 * @returns {Readonly<Record<string, readonly FieldError[]>>} field ids and
 * reserved keys, each holding the errors under it
 */
export function groupErrorsByField(
  definition: FormDefinition,
  errors: readonly ResponseError[],
): Readonly<Record<string, readonly FieldError[]>> {
  const grouped: Record<string, FieldError[]> = {};
  for (const entry of errors) {
    // Each error is copied into the field's own shape: the grouping is the
    // Caller's data from here on, and a shared reference back into the
    // Response would let a renderer mutate it.
    const key = keyForError(definition, entry.path);
    const bucket = grouped[key] ?? [];
    bucket.push({ code: entry.code, message: entry.message, path: entry.path });
    grouped[key] = bucket;
  }
  return grouped;
}

/**
 * The effective flags for one field, after rules and after inheritance.
 *
 * `RuleState`'s maps are keyed by field id and already carry container
 * inheritance, so a lookup here is the whole resolution. A field the maps do not
 * mention falls back to the node's own baseline for `required` and `readOnly`,
 * and to `true` for `visible` and `enabled`: a form nobody has evaluated yet is
 * a visible, editable form.
 *
 * `readOnly` never falls *below* the node. `LeafNode.readOnly` is where the
 * calculated signal already lives — `createFormDefinitionFromDescribed` folds
 * `definition.calculatedCodes` into it, and `applyEvaluation` folds it into the
 * state's own map — so the node alone answers "is this field calculated?" for a
 * state that says nothing. The core owns a calculated value and a renderer must
 * not write over it, which is why the baseline is an `or` and not a fallback:
 * a caller that hands in a map saying `false` cannot un-calculate the field.
 *
 * @param {LeafNode} node the leaf node being described
 * @param {RuleState} state the evaluation's effective flags, keyed by field id
 * @returns {ControlState} the four effective flags
 */
function effectiveState(node: LeafNode, state: RuleState): ControlState {
  return {
    enabled: state.enabled[node.id] ?? true,
    readOnly: node.readOnly || state.readOnly[node.id] === true,
    required: state.required[node.id] ?? node.required,
    visible: state.visibility[node.id] ?? true,
  };
}

/** `ControlConstraints` while it is being built; the interface is read-only. */
type MutableConstraints = { -readonly [Key in keyof ControlConstraints]: ControlConstraints[Key] };

/**
 * The constraints this type carries, under their wire names.
 *
 * `semanticDescriptorFor` is the filter: the core's own table says `number`
 * carries `minimum` and not `pattern`, so a document that carried both describes
 * only the one the core honours. The table also carries `title`, `description`
 * and `allowMultiple`, which are descriptor fields in their own right rather
 * than constraints. A type outside the vocabulary has no table entry and
 * therefore no constraints — it is described, not guessed at.
 *
 * @param {LeafNode} node the leaf node being described
 * @param {SemanticTypeDescriptor | null} semantics the core's entry for the
 * field's type, or `null`
 * @returns {ControlConstraints} the constraints this type carries, under their
 * wire names
 */
function constraintsFor(
  node: LeafNode,
  semantics: SemanticTypeDescriptor | null,
): ControlConstraints {
  if (semantics === null) {
    return {};
  }
  const carried = new Set(semantics.properties.map((property) => property.name)),
    field: Field = node.field,
    constraints: MutableConstraints = {};

  if (carried.has("minLength") && field.minLength !== undefined) {
    constraints.minLength = field.minLength;
  }
  if (carried.has("maxLength") && field.maxLength !== undefined) {
    constraints.maxLength = field.maxLength;
  }
  if (carried.has("pattern") && field.pattern !== undefined) {
    constraints.pattern = field.pattern;
  }
  if (carried.has("minimum") && field.minimum !== undefined) {
    constraints.minimum = field.minimum;
  }
  if (carried.has("maximum") && field.maximum !== undefined) {
    constraints.maximum = field.maximum;
  }
  if (carried.has("multipleOf") && field.multipleOf !== undefined) {
    constraints.multipleOf = field.multipleOf;
  }
  if (carried.has("decimalPlaces") && field.decimalPlaces !== undefined) {
    constraints.decimalPlaces = field.decimalPlaces;
  }

  return constraints;
}

/**
 * Whether `option` is one of the answers in a list-valued choice.
 *
 * @param {readonly unknown[]} list the answer, when it is a list
 * @param {string} option one option's value
 * @returns {boolean} whether that option is one of the selected answers
 */
function isMember(list: readonly unknown[], option: string): boolean {
  return list.includes(option);
}

/**
 * The choice's options, normalized, with selection resolved against the value.
 *
 * Only `choice` has options; every other type gets `[]`. Which shape the value
 * is compared against is decided by `allowMultiple`, the property the semantic
 * table names as the one that decides a choice's answer shape — not by whatever
 * happens to be in the value. The core converts both directions strictly, so an
 * `allowMultiple` choice holding a bare string is an answer the core would
 * reject, and reporting a selection for it would render a state that cannot be
 * submitted.
 *
 * @param {LeafNode} node the leaf node being described
 * @param {SemanticTypeDescriptor | null} semantics the core's entry for the
 * field's type, or `null`
 * @param {unknown} value this field's answer, code-keyed from the rule state
 * @returns {readonly ControlOption[]} normalized options for a choice, `[]` for
 * every other type
 */
function optionsFor(
  node: LeafNode,
  semantics: SemanticTypeDescriptor | null,
  value: unknown,
): readonly ControlOption[] {
  if (semantics?.type !== "choice") {
    return [];
  }
  const multiple = node.field.allowMultiple === true,
    answer: readonly unknown[] = Array.isArray(value) ? value : [];

  return node.options.map((option) => ({
    label: option.label ?? option.value,
    selected: multiple ? isMember(answer, option.value) : value === option.value,
    value: option.value,
  }));
}

/**
 * Describe one leaf field for one renderer draw.
 *
 * Total by contract: a type outside the core's vocabulary still produces a
 * descriptor, with empty `constraints` and empty `options`. The core does not
 * validate `widget` and a compiled form is only as trustworthy as the vocabulary
 * its caller compiled against, so a binding that threw here would be worse than
 * useless.
 *
 * @param {LeafNode} node the leaf node to describe
 * @param {RuleState} state the current rule state; `values` is keyed by field code
 * @param {readonly FieldError[]} [errors] this field's errors, from
 * `groupErrorsByField`
 * @returns {ControlDescriptor} the descriptor a renderer draws the control from
 */
export function describeField(
  node: LeafNode,
  state: RuleState,
  errors?: readonly FieldError[],
): ControlDescriptor {
  const semantics = semanticDescriptorFor(node.type),
    value = state.values[node.code],
    fieldErrors = errors ?? [];

  return {
    // `describedBy` names the field id only when there is a description to
    // Render behind it, so it never points at an element that was not described.
    aria: {
      invalid: fieldErrors.length > 0,
      ...(node.description === undefined ? {} : { describedBy: node.id }),
    },
    code: node.code,
    constraints: constraintsFor(node, semantics),
    errors: fieldErrors,
    id: node.id,
    label: node.label,
    ...(node.description === undefined ? {} : { description: node.description }),
    options: optionsFor(node, semantics, value),
    pointer: node.pointer,
    state: effectiveState(node, state),
    type: node.type,
    value,
  };
}
