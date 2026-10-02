/**
 * What a `choice` control has to decide: how the core's two answer shapes meet a
 * widget that draws values.
 *
 * A choice's answer is **not one shape**. The core decides it per field, from
 * `allowMultiple`, and it decides it strictly in both directions. From
 * `src/validate/conversion.rs` in the core:
 *
 * ```rust
 * // convert_multi_choice — a field with allowMultiple
 * let Some(Json::Array(items)) = value else {
 *     return Err(type_error(field, "an array of choice values"));
 * };
 * // convert_single_choice — a field without it
 * let Some(choice) = value.and_then(Json::as_str) else {
 *     return Err(type_error(field, "a choice value"));
 * };
 * ```
 *
 * So a single-select answers with a scalar and a multiple one with a list, and
 * each rejects the other's shape — measured against the running core, `["red"]`
 * for a single-select reports *must be a choice value* and `"a"` for a multiple
 * reports *must be an array of choice values*. This module used to say the
 * opposite, in a comment that read *a choice's answer is a list, whatever the
 * widget shows*, and shipped a control that answered a dropdown with
 * `["red"]`. That is a false validation error on an ordinary action, caused
 * entirely by a type that was wrong.
 *
 * The empty value the old example hardcoded is still handled, and the handling
 * is still necessary: a `Select`-shaped widget wants a string in its `value`
 * prop, and a choice's answer may be absent. That is what
 * {@link choiceEmptyValue} is for, and the same check against the field's own
 * options still applies — a document offering an option of exactly that name
 * would otherwise render that option as the chosen one.
 *
 * There is deliberately **no** defensive reader for an `unknown` answer here,
 * the way {@link checkedFrom} is one for a boolean, and the corpus is the
 * reason. `ColanderBinding.value` (`src/runtime.ts:62`) is `unknown` at
 * runtime, so a control *can* be handed something that is not a choice answer
 * at all. A reader that coerced it would have to be wrong about a shape the
 * core owns: turning a scalar into `[]` would replace the core's own report
 * with a value the core accepts, and dropping non-strings would do the same for
 * `type-error-choice-number`'s `INVALID_TYPE`. Both are rewrites of an answer,
 * which is the one thing a utility here may not do. A boolean's reader gets away
 * with being total because there is nothing there to preserve: a boolean has no
 * absent state, so a non-boolean is not a degraded version of anything. A
 * choice's answer is whichever shape the field's `allowMultiple` calls for, and
 * a value of some third shape is a report the core owes, not a state this
 * package may summarise.
 */

import type { FieldOption } from "@ailura/colander-client";

import type { ChoiceAnswer } from "../host.js";

/**
 * The decisions a `choice` control takes from the field's options and answer.
 *
 * Every member below takes or returns the shape the field's own `allowMultiple`
 * calls for, and that is what makes them usable by one control for both
 * configurations. What a consumer still has to decide for itself, and this
 * module does not decide for it:
 *
 * - **Which shape to read an answer that arrived in the other one.** A document
 *   is parsed at runtime, so a control is handed a scalar for a field that sets
 *   `allowMultiple` if the document and the stored answer disagree. That is a
 *   defect to surface, not to reconcile: reconciling it here would make the
 *   core's `must be an array of choice values` unreachable, exactly as
 *   dropping an unlisted value would make `contains an invalid choice value.`
 *   unreachable.
 * - **Whether the field's single-select affordance is even permitted.** The
 *   core declares `allowMultiple` and enforces the list shape when it is set;
 *   nothing in the corpus says a document may not be rendered by a one-value
 *   widget, so a consumer that wants to refuse the degradation rather than
 *   perform it has to make that call itself.
 * - **What to do with an answer that names values the field does not offer.**
 *   The corpus is explicit that such an answer is an error —
 *   `choice-invalid-value` and `choice-allow-multiple-invalid-member` both
 *   report `contains an invalid choice value.` — and the utilities below keep
 *   the answer intact and refuse only to *select* it in the widget. Replacing
 *   the answer would make that error unreachable.
 */

/**
 * The decisions a `choice` control takes, as the interface a registry keys by
 * type. Its members are the named functions below, under shorter names.
 */
export interface ChoiceUtilities {
  /**
   * The value an unanswered choice holds: `null` for a single-select, `[]` for
   * a multiple one.
   *
   * A host must hand a choice an answer even when nobody has answered it, and
   * the two configurations disagree on what that is. The core accepts an absent
   * value for every field, so `null` is a real state and not a hole; `[]` is
   * the shape {@link choiceAnswerFrom} already produces for an empty selection
   * on a multiple choice. A host that is handed `undefined` instead gets a
   * control that either iterates it — `undefined` throws "answer is not
   * iterable" and takes the page down — or branches on something the core
   * never said.
   */
  readonly unansweredValue: ChoiceUnansweredValue;
  /** A value no option in this field carries, for "nothing is selected". */
  readonly emptyValue: (options: readonly FieldOption[]) => string;
  /**
   * The one value a single-value widget shows for this answer, whichever of the
   * two shapes the answer arrived in.
   */
  readonly controlValue: (answer: ChoiceAnswer, options: readonly FieldOption[]) => string;
  /**
   * The answer a single-value widget reports: a scalar for a single-select
   * choice and a one-entry list for a multiple one.
   */
  readonly answerFrom: ChoiceAnswerFrom;
  /** Whether an answer carries an option, for a control drawing toggles. */
  readonly has: (answer: ChoiceAnswer, value: string) => boolean;
}

/**
 * {@link ChoiceUtilities.unansweredValue}, narrowed by the field's own
 * `allowMultiple`.
 *
 * Overloaded rather than a single `(allowMultiple?: boolean)` so a caller that
 * holds a narrowed `true` gets `readonly string[]` and a caller holding a
 * narrowed `false` gets `null`, with no assertion at the call site. The
 * optional second case is the absent property: a field that does not declare
 * `allowMultiple` is a single-select choice as far as the core is concerned.
 */
export interface ChoiceUnansweredValue {
  (allowMultiple: true): readonly string[];
  (allowMultiple?: false): null;
}

/**
 * {@link ChoiceUtilities.answerFrom}, narrowed the same way.
 *
 * The two overloads are what make a control's `onChange` call type-check
 * against the branch it is in: in the multiple branch the callback accepts
 * `readonly string[]` and this returns one, and in the single-select branch the
 * callback accepts `string | null` and this returns one of those.
 */
export interface ChoiceAnswerFrom {
  (selected: string, options: readonly FieldOption[], allowMultiple: true): readonly string[];
  (selected: string, options: readonly FieldOption[], allowMultiple?: false): string | null;
}

/**
 * The base name the empty value is built from, and the one the old example
 * hardcoded.
 *
 * Kept readable and recognisable on purpose: a sentinel that reached a DOM
 * inspector should look like what it is. It is only the *first* candidate, and
 * it is a candidate rather than an answer — {@link choiceEmptyValue} extends it
 * until the field's own options prove it unusable.
 */
const EMPTY_VALUE_BASE = "__colander_no_answer__";

/**
 * A value no option in this field carries, so a single-select control can hold
 * "nothing is selected" as a real value rather than as an absent one.
 *
 * A `Select`-shaped widget wants a value in its `value` prop, and a choice's
 * answer may be the empty list, so the control needs a string that means "no
 * option" — a string that is *not* an option's value, or the widget would draw
 * a selection the field never offered. The old example wrote
 * `const empty = "__colander_no_answer__"` and used it unchecked: a document
 * with an option of exactly that value renders as though that option were
 * chosen, and the answer the control then reports is that option. So the name
 * is generated against the options it has to survive.
 *
 * The rule is deterministic and total: start at {@link EMPTY_VALUE_BASE} and,
 * while the candidate equals some option's value, append the next integer. So
 * the base is used whenever it is free, and `…_1`, `…_2`, … are used only where
 * the field really does carry the shorter one. The base ends in `_`, so no two
 * candidates can be confused for one another by their digits, and the same
 * options always give the same value: a control that re-derives this on every
 * render must not be able to change its own selection underneath itself.
 *
 * The result is always a value the field does not offer, which is the property
 * this function exists to guarantee. It is not a claim the core enforces: the
 * core never sees it, because a control converts it back to the field's own
 * unanswered answer before it reports ({@link choiceAnswerFrom} — `null` for a
 * single-select, `[]` for a multiple), and the core rejects a value it did not
 * offer anyway (`choice-invalid-value`).
 */
export function choiceEmptyValue(options: readonly FieldOption[]): string {
  const offered = new Set(options.map((option) => option.value));
  let candidate = EMPTY_VALUE_BASE;
  let suffix = 0;
  while (offered.has(candidate)) {
    suffix += 1;
    candidate = `${EMPTY_VALUE_BASE}${suffix}`;
  }
  return candidate;
}

/**
 * The one value a single-value widget shows for this answer.
 *
 * Both answer shapes are accepted, and each is narrowed by a real branch rather
 * than by a cast — this function is the reason the union is safe to hand to a
 * control. A single-select's answer is a string, so it is tested as one; a
 * multiple's is a list, so it is iterated; an absent answer is `null`, and there
 * is nothing to show. The narrowing is a `typeof` test and a `null` test, which
 * is why no assertion appears below: a cast here would have meant the types
 * were wrong and the cast was hiding it.
 *
 * The first answer entry that names a real option in this field, because a
 * control cannot display a value the field does not offer: rendering an answer
 * the core will reject as an invalid choice value would show the user a
 * selection that is not in the form, and the corpus says that answer is an
 * error (`Field 'patient.color' contains an invalid choice value.`). So an
 * unknown entry is skipped, not selected, and the next real entry is used.
 *
 * An answer that names no option at all — including `[]` — shows
 * {@link choiceEmptyValue}. The answer is not rewritten: it stays as the caller
 * holds it, with its unknown entries intact, because a utility never rewrites an
 * answer. What is narrowed is only what a one-value widget can put on an
 * element.
 */
export function choiceControlValue(answer: ChoiceAnswer, options: readonly FieldOption[]): string {
  const offered = new Set(options.map((option) => option.value));
  const shown = (candidate: string): boolean => offered.has(candidate);
  if (typeof answer === "string") {
    return shown(answer) ? answer : choiceEmptyValue(options);
  }
  if (answer === null) {
    return choiceEmptyValue(options);
  }
  for (const value of answer) {
    if (shown(value)) {
      return value;
    }
  }
  return choiceEmptyValue(options);
}

/**
 * The answer a single-value widget reports, in the shape the field's own
 * `allowMultiple` calls for.
 *
 * A single-select reports the scalar the widget is showing, or `null` for the
 * empty value; a multiple reports a one-entry list, or `[]` for the empty value.
 * That is the core's rule and not this package's preference:
 * `convert_single_choice` takes `Json::as_str` and rejects a list, and
 * `convert_multi_choice` takes `Json::Array` and rejects a scalar.
 *
 * The empty selection is a real answer in both configurations and the core
 * accepts both forms of it, because an absent value is valid for every field.
 * Returning `[]` for a single-select because that is what this function used to
 * return would reintroduce exactly the defect this change removes.
 *
 * The `options` argument is the same one `choiceControlValue` was given, and it
 * is needed for one reason: the empty value is derived from the options, so
 * without them this function could not tell "nothing is selected" from "the
 * field offers a real option of that name" — the collision the old example
 * could not detect either.
 *
 * It does not check that `selected` is one of the options. A widget can only
 * report a value it was given, and a value the field does not offer is exactly
 * the answer the core must be able to reject; dropping it here would make
 * `Field 'patient.color' contains an invalid choice value.` unreachable.
 */
export function choiceAnswerFrom(
  selected: string,
  options: readonly FieldOption[],
  allowMultiple: true,
): readonly string[];
export function choiceAnswerFrom(
  selected: string,
  options: readonly FieldOption[],
  allowMultiple?: false,
): string | null;
export function choiceAnswerFrom(
  selected: string,
  options: readonly FieldOption[],
  allowMultiple?: boolean,
): string | null | readonly string[] {
  const chosen = selected === choiceEmptyValue(options) ? undefined : selected;
  if (allowMultiple === true) {
    return chosen === undefined ? [] : [chosen];
  }
  return chosen ?? null;
}

/**
 * Whether an answer carries an option, for a control that renders a list of
 * toggles.
 *
 * Membership, and nothing about the options: the caller already holds the
 * options it is rendering, and an answer that names a value the field does not
 * offer is not this function's to hide. A multiple-select control needs no other
 * utility in this module beyond the round trip — it holds the core's list as a
 * list — and a single-select's scalar is a one-element list, which is the
 * comparison below rather than a separate code path.
 */
export function choiceHas(answer: ChoiceAnswer, value: string): boolean {
  if (answer === null) {
    return false;
  }
  return typeof answer === "string" ? answer === value : answer.includes(value);
}

/**
 * The value an unanswered choice holds, in the shape the field's own
 * `allowMultiple` calls for.
 *
 * `[]` for a multiple choice, `null` for a single-select, and never
 * `undefined`: an absent answer arrives at a control as `undefined` from a
 * `Map.get`, and every reader here would then have to defend against a state
 * the core does not have.
 *
 * The overloads are what a caller narrows against. A host that holds a
 * `boolean | undefined` from a parsed document cannot use them directly, and
 * should not pretend to: {@link unansweredValueFor} in the registry is the
 * lookup that takes the field's property and does this dispatch in one place.
 *
 * @param allowMultiple the field's `allowMultiple`, absent meaning single-select
 * @returns `[]` for a multiple choice, `null` for a single-select
 */
export function unansweredChoiceValue(allowMultiple: true): readonly string[];
export function unansweredChoiceValue(allowMultiple?: false): null;
export function unansweredChoiceValue(allowMultiple?: boolean): null | readonly string[] {
  return allowMultiple === true ? [] : null;
}
