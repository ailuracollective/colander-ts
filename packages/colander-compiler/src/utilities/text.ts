/**
 * What a `text` and a `textarea` control have to decide.
 *
 * Deliberately the thinnest surface in this package, and the corpus is why. A
 * `text` field declares `minLength`, `maxLength` and `pattern`; a `textarea`
 * declares the first two. All three are constraints the core states and all
 * three arrive under their own names, so a control forwards them to its element
 * and nothing here is derived. That is what `controlPropsFor` (`runtime.ts:87`)
 * already does, and a utility for a pure rename would be ceremony: the compiler
 * names a semantic concept and returns a plain value, and "the property's name
 * is its name" is not a decision.
 *
 * So what is left is the one question a string control really does have, and the
 * answer is the non-inventing one: a control reports what the user typed and
 * lets the core decide whether it is an answer.
 *
 * The one declared property with no utility is `pattern`, and its absence is a
 * finding rather than an omission. The corpus cannot prove what the core does
 * with a regular expression: `validate.json:3908` rejects `"AB1"` against
 * `^[a-z]+$` and `:3963` accepts `"abc"`, but that pattern carries its own `^`
 * and `$`, and every case in the corpus either matches the expression in full or
 * does not contain it at all. Nothing distinguishes "the core anchors the
 * pattern" from "the core applies it as a search", so a utility that tested a
 * string here would be guessing a regex semantic the core never stated, and a
 * guess here is the one thing this package exists to remove. A consumer forwards
 * the name; the element and the core decide what it means.
 */

/**
 * The decisions a `text` control takes from what the user typed.
 *
 * No constraints parameter, and deliberately none to invent: the declared
 * properties of a `text` are forwarded under their own names rather than
 * derived, so a utility that took them could only return them again.
 */
export interface TextUtilities {
  /** The string the core is to validate, from what the user typed. */
  readonly answerFrom: (raw: string) => string;
  /** The value an unanswered field of this family holds. */
  readonly unansweredValue: () => string | null;
}

/**
 * The string the core is to validate, from what the user typed.
 *
 * It returns the string **unchanged**, and it exists anyway, which is the part
 * worth defending.
 *
 * A text field's answer may be absent, and a control that holds `null` for an
 * empty input has to decide at the edge what "empty" means. That decision is
 * the core's. `packages/colander-client/src/form-definition.ts:588` refuses to
 * convert an answer in the client because converting it "would hide the error
 * the caller needs to see", and the same reasoning runs the other way here: a
 * control that substitutes `null` for `""` makes the core's decision for it.
 *
 * The corpus says only that `""` is at least a well-typed answer value, which is not
 * the same as saying it is an answer: `validate.json:1258`
 * (`readonly-field-empty-ok`) answers a text field with `""` and is normalised
 * to `{}` under `REQUIRED_FIELD_MISSING` for a *different* field, with no
 * `INVALID_TYPE` for the empty string. So `""` is reported as `""` and not as
 * `null`, because "the user cleared the field" and "the field is not an answer"
 * are two states, and only the core may decide which one a cleared field is.
 *
 * There is no trim and no length check either, and that is not an oversight to
 * be fixed later. A utility that restricted a string the core has not rejected
 * would put its own rule between the user and the core's own message: the
 * corpus reports `Field 't' must be at least 3 characters.` (`validate.json:3846`)
 * and `Field 't' must be at most 5 characters.` (`:3901`), and a control that
 * refused to report a two-character answer would make those errors unreachable
 * while adding a message the core never wrote. `minLength`, `maxLength` and
 * `pattern` are forwarded to the element under the names the core gave them.
 *
 * The name is the numeric family's, so the registry reads the same way for
 * every type: `numberAnswerFrom`, `textAnswerFrom`.
 */
/**
 * The value an unanswered text field holds: `null`.
 *
 * `ControlValue<"string">` is `string | null`, so `null` is the shape the
 * contract expects, and a control that substituted `""` for a missing answer
 * would be answering for the user rather than reporting that there is none.
 */
export function unansweredTextValue(): string | null {
  return null;
}

export function textAnswerFrom(raw: string): string {
  return raw;
}

/**
 * The statement that a `textarea`'s utilities are a `text`'s.
 *
 * A `textarea` declares no property beyond the shell's own two, so it has no
 * constraints to take and the same answer to give. It is an alias rather than a
 * second interface so that "the two string-like types are the same decision" is
 * a fact the types carry, and so a control for either type cannot drift into a
 * near-copy of the other's answer.
 */
export type TextareaUtilities = TextUtilities;
