/**
 * What a `boolean` control has to decide: one thing, and there is only one
 * answer to it.
 *
 * A boolean is the only type in the core's table whose answer is never absent.
 * An unchecked box is an answer, not a missing one, so this family has no
 * absent state to report, no `null`, and no numeric `""` to interpret — which is
 * why its surface is one function and the string-like types' is one function
 * with a different signature.
 *
 * The corpus backs the shape: `validate.json`'s `type-error-boolean-string`
 * reports `Field 'patient.active' must be a boolean.` for the string `"true"`,
 * so the core is strict about a non-boolean reaching a boolean field and does
 * not coerce it. This module does not coerce it either; see {@link checkedFrom}
 * for what it does with a value of another shape, and why that is not the same
 * thing.
 */

/**
 * The decisions a `boolean` control takes from its own state.
 *
 * No constraints parameter, because the core declares no property for a
 * `boolean` beyond the shell's own two. An empty constraints type would accept
 * anything and mean nothing by it, so the absence is the contract.
 */
export interface BooleanUtilities {
  /** The boolean the core is to validate, from the control's own state. */
  readonly checkedFrom: (value: unknown) => boolean;
  /**
   * The value an unanswered boolean holds, which is `false` and not "nothing".
   *
   * Named the same way as the choice family's, for the same reason: "nothing
   * answered" is a different thing from a sentinel a widget puts on an element.
   */
  readonly unansweredValue: () => boolean;
}

/**
 * The boolean the core is to validate, from what a checkbox currently holds.
 *
 * Anything that is not exactly `true` is `false`, and that is the whole rule.
 * A checkbox has two states and no third: it is either drawn ticked or it is
 * not, and "not ticked" is `false`, which is an answer the core accepts.
 * `ControlChange<"boolean">` (`src/host.ts:37`) already states that a boolean
 * may not report `null`, and this is the function that makes that type
 * reachable: whatever the control was handed, what it reports is a boolean.
 *
 * The parameter is `unknown` on purpose. `ColanderBinding.value`
 * (`src/runtime.ts:62`) is typed `unknown` because the core's own answers index
 * holds unknown values, so a control has to be able to render before the
 * document has said anything about this field, and an absent answer is `null`
 * rather than `false` on the wire. Narrowing that at the type level would be a
 * claim about the document that the document has not made.
 *
 * The honest limit of the rule, stated rather than hidden: for a value that is
 * not a boolean at all, this reports the control's own state instead of the
 * value. That is a real loss, and it is bounded by where the value comes from.
 * The core's strictness about a string in a boolean field is about an answer
 * arriving from outside a checkbox — a stale document, a tampered payload — and
 * `type-error-boolean-string` is a validation of such an answer. A control is
 * not that path: it does not hold the wire value, it holds whether a box is
 * drawn ticked, and that is a boolean by the time this is called. A defensive
 * reader here could only throw (taking the render down over an answer the core
 * would have reported in one message) or invent a boolean, so the non-inventing
 * answer is the state the control actually has.
 */
export function checkedFrom(value: unknown): boolean {
  return value === true;
}

/**
 * The value an unanswered boolean field holds.
 *
 * `ControlValue<"boolean">` is `boolean` with no `null` and no `undefined`
 * (`src/host.ts:17-40`), so "not answered" is `false` and there is no third
 * state to represent. A host that binds a control with `undefined` is handing it
 * something the contract does not allow, whatever a checkbox does with it.
 */
export const unansweredBooleanValue = (): boolean => false;
