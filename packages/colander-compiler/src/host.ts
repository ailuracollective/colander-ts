/**
 * The contract between a generated control and whatever renders a form around it.
 *
 * This is the part of the compiler that is not derived from the core: a
 * generated control cannot render itself, so it is handed the field's identity,
 * its answer, and whether the core says the field may be edited. A consumer
 * supplies that context by binding one generated control to one field.
 *
 * It is declared here, in a module that contains no framework, so the generated
 * tree can re-export it and a consumer's own component can import it without
 * either side depending on the other's files.
 */

import type { FieldOption, SemanticValueKind } from "@ailura/colander-client/semantics";

/**
 * The answer a control of a given value shape holds, *inbound*.
 *
 * This is the shape an existing answer arrives in, which is the only sense in
 * which "the shape of the answer" is a fact about a control rather than a fact
 * about the field being answered.
 *
 * For every kind but one this is a single shape, and it is worth being explicit
 * about why the two directions are separate types at all. They are not the same
 * type because a control must be *able to report* every answer it is able to
 * *hold*. A `text` control holds `string | null` and reports `string | null`;
 * a `boolean` control holds `boolean` and must not report `null`, because an
 * unchecked box is an answer rather than an absence and a control that reported
 * `null` there would hide the core's own requirement.
 *
 * **`"string-or-string-list"` is where the two come apart, and it is the defect
 * this shape exists to name.** A `choice` answers with a scalar when the field
 * does not set `allowMultiple` and with a list when it does, so the inbound
 * value has to admit both — a control genuinely can be handed either, depending
 * on the document it is rendering. The *outbound* answer is not a union in
 * practice: for a given field exactly one of the two is accepted by the core,
 * and {@link ControlChange} is where that fact is stated.
 */
export type ControlValue<V extends SemanticValueKind> = V extends "string"
  ? string | null
  : V extends "number"
    ? number | null
    : V extends "boolean"
      ? boolean
      : V extends "string-or-string-list"
        ? ChoiceAnswer
        : readonly string[];

/**
 * Every shape a `choice`'s answer can arrive in, and no other.
 *
 * `null` is here because a single-select choice is unanswered as `null`: the
 * core accepts an absent value for every field, and `null` is what the string
 * family already uses to say "not answered". The list is here because a
 * multiple choice's empty answer is `[]`, which the core also accepts. A
 * single-select's `[]` is accepted too, and deliberately not excluded: the core
 * is what decides that, and a type that forbade it here would be making the
 * core's rule unreachable in the one place it is cheap to state.
 */
export type ChoiceAnswer = string | null | readonly string[];

/**
 * The answer a single-select choice reports, and the answer a multiple one
 * does, stated as the two shapes the core accepts for those configurations.
 *
 * This is the union that has to be split before it is used, and the split is
 * the whole point: `ControlChange<"string-or-string-list">` with no second
 * argument would have to be `string | readonly string[]`, and a type that
 * admits both tells a control author that reporting either is fine. It is not —
 * `convert_single_choice` rejects a list and `convert_multi_choice` rejects a
 * scalar. Naming the configuration turns that from a runtime failure the user
 * sees into a compile error the control's author sees.
 */
export type ChoiceChange<AllowMultiple extends boolean> = AllowMultiple extends true
  ? readonly string[]
  : string | null;

/**
 * What a control reports back when the answer changes.
 *
 * `null` is allowed wherever an absent answer is meaningful: clearing a text or
 * number field leaves it unanswered, and that is a real state a control has to be
 * able to report. A boolean is different — an unchecked checkbox is an answer,
 * not an absence — so it reports neither `null` nor a list.
 *
 * The second parameter is the field property that decides a type's answer shape,
 * narrowed to a literal. It defaults to `false` because a field that does not
 * declare `allowMultiple` *is* a single-select choice as far as the core is
 * concerned, and because every other kind ignores it. For a choice it is what
 * makes the reported answer honest: `ControlChange<"string-or-string-list",
 * true>` is a list and nothing else, and `…, false>` is a scalar and nothing
 * else.
 *
 * What a control may not do is report a value of the wrong type to make the core's
 * strict conversion unreachable: that check is the core's job, and a control that
 * hides it removes the signal the caller needs. That is the reason the choice
 * branch above is keyed on the configuration rather than left as a union.
 */
export type ControlChange<
  V extends SemanticValueKind,
  AllowMultiple extends boolean = false,
> = V extends "boolean"
  ? boolean
  : V extends "string-or-string-list"
    ? ChoiceChange<AllowMultiple>
    : ControlValue<V>;

/**
 * What a consumer's own component receives, whatever type it materialises.
 *
 * `required`, `readOnly` and the rest are the core's own conclusions, forwarded
 * unchanged: a generated control that re-derived them from the document would be
 * able to disagree with the core about the same field.
 */
export interface HostControlProps<
  V extends SemanticValueKind,
  AllowMultiple extends boolean = false,
> {
  /** A DOM-safe id, already unique within the form. */
  readonly id: string;
  /** The field's answer code, which is the key in the answers object. */
  readonly code: string;
  /** The current answer, in the shape this type declares. */
  readonly value: ControlValue<V>;
  /** Report a new answer, in the shape this field's configuration accepts. */
  readonly onChange: (value: ControlChange<V, AllowMultiple>) => void;
  /** The core says the field may not currently be edited. */
  readonly disabled: boolean;
  /** The core says the field's answer is not the user's to change. */
  readonly readOnly: boolean;
  /** The core says the field must carry an answer to be valid. */
  readonly required: boolean;
  /**
   * The options the core published for this field.
   *
   * Every leaf node carries an options list, empty for every type but a choice,
   * because that is what the core's own model holds. Only a control that draws a
   * choice reads it.
   */
  readonly options: readonly FieldOption[];
}

/**
 * What a generated field component receives: the control's context plus the
 * text and the messages the shell renders.
 */
export type HostFieldProps<
  V extends SemanticValueKind,
  AllowMultiple extends boolean = false,
> = HostControlProps<V, AllowMultiple> & {
  /** The display label the core derived for this field. */
  readonly label: string;
  /** The field's description, when it has one. */
  readonly description?: string;
  /** Messages the core reported against this field. */
  readonly errors: readonly string[];
};

/** What the consumer's shell receives around one control. */
export interface FieldShellProps {
  /** The id the control was given, so the shell can point its label at it. */
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly description?: string;
  readonly errors: readonly string[];
  readonly children: unknown;
}

/** The shape a plan's property entry has, which is what this type is derived from. */
export interface SemanticPropertyLike {
  readonly name: string;
  readonly type: string;
}

/**
 * The semantic properties one type declares, as the props of a component.
 *
 * Derived from the core's table, so a property the core adds to a type reaches
 * the consumer's component as a TypeScript error until it is handled — which is
 * the point of generating from the core rather than from a hand-written list.
 */
export type SemanticControlProps<P extends SemanticPropertyLike | readonly SemanticPropertyLike[]> =
  SemanticPropsOf<P extends readonly SemanticPropertyLike[] ? P[number] : P>;

/** The props of a set of properties, whatever shape the set arrives in. */
type SemanticPropsOf<P extends SemanticPropertyLike> = {
  [K in P as K["name"]]?: K["type"] extends "string"
    ? string | undefined
    : K["type"] extends "number"
      ? number | undefined
      : boolean | undefined;
};

/**
 * The two properties that describe a field rather than constrain its answer.
 *
 * They are real properties of every type in the core's table, and a consumer's
 * control may well want them. The generated tree does not forward them to the
 * control, because the shell already renders both and forwarding them twice
 * would put the same text in two places by construction. A template owns this
 * rule; it is a statement about the shell, not about the semantics.
 */
export const SHELL_OWNED_PROPERTIES: readonly string[] = ["title", "description"];
