/**
 * What a `number` and an `integer` control have to decide.
 *
 * Both types are numeric, and a control for either of them does the same two
 * things: it steps by some granularity, and it reports the number the user
 * produced. What differs is not the arithmetic but what the core says, and the
 * core says it in two very different places — which is why the two types get
 * two answers rather than one shared rule.
 *
 * The step of a `number` follows `multipleOf` because the core enforces
 * `multipleOf` on a `number`; the step of an `integer` follows it only when it
 * happens to divide evenly, because the corpus accepts `multipleOf: 0.5` on an
 * `integer` and never reports it. That asymmetry is the reason this module
 * exists rather than a single `stepFor`, and each rule below carries the line of
 * the corpus that decided it.
 *
 * Both types share the answer utility, and neither of them rounds it: the core
 * is strict about a value a control altered on purpose, and a rounded answer
 * removes the error its caller needs to see.
 */

import type { IntegerConstraints, NumberConstraints } from "./contract.js";

/**
 * The decisions a `number` control takes from the field's declared properties.
 *
 * Named for the type rather than shared with `integer` because the two types
 * have different parameters: a `number` field declares `decimalPlaces` and an
 * `integer` field does not, so a control for one cannot be handed the other's
 * field without a compile error.
 */
export interface NumberUtilities {
  /**
   * The granularity the control steps by, or `undefined` when the field
   * declares none.
   *
   * `undefined` is a real answer and not the same as `1`: a control that cannot
   * tell "no step was declared" from "step by one" will invent a step.
   */
  readonly step: (constraints: NumberConstraints) => number | undefined;
  /** The value an unanswered field of this family holds. */
  readonly unansweredValue: () => number | null;
  /** The number the core is to validate, from what the user typed. */
  readonly answerFrom: (raw: string) => number | null;
}

/**
 * The decisions an `integer` control takes from the field's declared properties.
 *
 * Its step is a plain number rather than a possibly-absent one, because an
 * integer control always steps by whole units: there is a correct granularity
 * for every integer field whether it declares one or not.
 */
export interface IntegerUtilities {
  /** The granularity the control steps by, never absent. */
  readonly step: (constraints: IntegerConstraints) => number;
  /** The value an unanswered field of this family holds. */
  readonly unansweredValue: () => number | null;
  /** The number the core is to validate, from what the user typed. */
  readonly answerFrom: (raw: string) => number | null;
}

/**
 * The granularity a control for a `number` field steps by.
 *
 * Two rules, in this order, and the first one is the only rule the core
 * enforces:
 *
 * 1. A `multipleOf` that is a finite number greater than zero *is* the step. The
 *    core enforces `multipleOf` on a `number` — the corpus at
 *    `validate.json:4122` produces `Field 'n' must be a multiple of 0.5.` — so a
 *    step taken from it constrains nothing the core would not already reject.
 *    Anything that is not finite and positive cannot be a granularity and is
 *    passed over rather than handed to an element as `NaN` or `-1`.
 *
 * 2. Failing that, an `integer` `decimalPlaces` of zero or more gives
 *    `10 ** -decimalPlaces`, and it is a **precision hint, not a constraint**.
 *    `decimalPlaces` has zero occurrences anywhere in the validation corpus: the
 *    core states nothing about it on any type, so a step derived from it is the
 *    control's own rounding suggestion and not a rule the core stands behind. The
 *    old example implementation documented this as though the core enforced it,
 *    and that comment is the single most misleading line being replaced here.
 *    A negative or fractional `decimalPlaces` describes no granularity at all and
 *    is refused rather than turned into `10 ** -(-1)` or `10 ** -0.5`.
 *
 * Failing both, `undefined`, because the field declared nothing a control may
 * step by.
 *
 * The parameter is the field's constraints object rather than loose positional
 * values, so `stepForNumber(numberProps)` — a control's own props — type-checks
 * with no intermediate type and no way to swap the two arguments.
 */
export function stepForNumber(constraints: NumberConstraints): number | undefined {
  const { multipleOf, decimalPlaces } = constraints;
  if (typeof multipleOf === "number" && Number.isFinite(multipleOf) && multipleOf > 0) {
    return multipleOf;
  }
  if (typeof decimalPlaces === "number" && Number.isInteger(decimalPlaces) && decimalPlaces >= 0) {
    return 10 ** -decimalPlaces;
  }
  return undefined;
}

/**
 * The granularity a control for an `integer` field steps by.
 *
 * A `multipleOf` is honoured only when it preserves integrality — when stepping
 * by it can only ever produce whole units. That is the case when it is a whole
 * number itself (`2`, `5`) or when it is the reciprocal of one (`0.5` in two
 * steps, `0.25` in four, `0.1` in ten). Anything else is `1`, which is what an
 * integer control steps by when the field says nothing.
 *
 * The corpus is the whole reason this is not the number rule. `validate.json:4232`
 * and `:4281` both declare `"multipleOf": 0.5` on an `integer` field and both
 * return zero errors: the core accepts that declaration and never enforces it
 * there. A step of `0.5` on an integer control would make the element refuse
 * integers the core accepts — `3` would be unreachable from the keyboard — which
 * is exactly the invention the package's derivation rule forbids. The old
 * example claimed the opposite rule in a comment next to a correct expression,
 * and the comment was wrong: the expression was right for a different reason than
 * the one it gave.
 *
 * The test is done in floating point, which is honest about its own limits.
 * `1 / 0.1` is exactly `10`, so a `multipleOf` of `0.1` is honoured and a
 * `multipleOf` of `1 / 3` is honoured for the same reason; a value that is not a
 * clean fraction of one — `0.3`, whose reciprocal is not an integer — is
 * refused, which is the answer the core's silence requires.
 */
export function stepForInteger(constraints: IntegerConstraints): number {
  const { multipleOf } = constraints;
  if (typeof multipleOf === "number" && Number.isFinite(multipleOf) && multipleOf > 0) {
    // A whole number needs no division to land on a whole unit, and a fraction
    // Reaches one only when one divided by it is itself whole.
    if (Number.isInteger(multipleOf) || Number.isInteger(1 / multipleOf)) {
      return multipleOf;
    }
  }
  return 1;
}

/**
 * The number the core is to validate, from what the user typed.
 *
 * A string that is empty or only whitespace is `null`: "not answered yet" and
 * "answered with zero" are different states and the core distinguishes them, so
 * `"0"` is reported as `0` and never as the absence of an answer.
 *
 * Anything else is `Number.parseFloat`, and the result only when it is finite, so
 * `"abc"` and an overflowing exponent such as `"1e999"` do not become `NaN` and
 * `Infinity` answers the core would have to reject as a type error instead.
 *
 * A fractional answer is returned **unchanged**. The core is strict about this on
 * purpose — `packages/colander-client/src/form-definition.ts:588` refuses to
 * convert a string in a `number` field because converting it "would hide the error
 * the caller needs to see" — so a control that rounds, clamps or drops the
 * fraction removes the signal the core exists to report.
 *
 * An `integer` control calling this is correct, and is not the rounding it may
 * look like. This function does not round to an integer precisely because the
 * integer's protection is its step ({@link stepForInteger}) and the step is the
 * core's business to ignore: the core will not catch a fractional answer to an
 * `integer` field, and hiding that here would make the one place it is visible
 * unreachable. The old example's comment claimed the answer was parsed as an
 * integer while its code did no such thing; the code is right, and the comment
 * was the error.
 *
 * This is a pure function that returns the answer rather than one that reports
 * it through a callback. A utility that called back for the caller would hide the
 * answer from the one place that has to decide what to do with it.
 */
/**
 * The value an unanswered numeric field holds: `null`.
 *
 * `ControlValue<"number">` is `number | null`, so "not answered" is a real
 * answer here and not an absence — which is why `numberAnswerFrom` returns
 * `null` for an empty input rather than `0`.
 */
export function unansweredNumericValue(): number | null {
  return null;
}

export function numberAnswerFrom(raw: string): number | null {
  if (raw.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
