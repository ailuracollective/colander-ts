import { describe, expect, it } from "vitest";

import type { ControlChange, ControlProps } from "../src/contracts.js";
import { checkedFrom, textAnswerFrom } from "../src/utilities.js";
import type {
  BooleanUtilities,
  TextareaConstraints,
  TextConstraints,
  TextUtilities,
  TextareaUtilities,
} from "../src/utilities.js";

/**
 * The string-like and boolean decisions, with the corpus line that decided each
 * one in the test that would fail without it.
 *
 * These utilities are the ones a reviewer is most likely to call useless,
 * because each of them changes nothing. That is the point, and it is the thing
 * a test has to defend: a control that substitutes `null` for `""`, that trims,
 * that checks a length, or that reads a checkbox with a truthiness test, is
 * each one plausible, close to the code next to it, and quietly making a
 * decision the core owns. So every case below is phrased as the claim it
 * protects, and the two type-level cases are here for the same reason as the
 * runtime ones: a constraint type drifts silently.
 */

/**
 * The exactness check the type-level cases are written with.
 *
 * A constraint type is wrong in a way no runtime assertion can see: wrong when a
 * name is missing, one is extra, or one carries the wrong TypeScript type. Each
 * case below is therefore a compile-time statement whose value is also checked
 * at runtime, so a drift in the core's table shows up either as a failing build
 * or as a failing test, never as a silent widening.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** A text control's own props, which is what a control actually has to hand. */
const TEXT_PROPS: ControlProps<"text"> = {
    code: "t",
    disabled: false,
    id: "field-t",
    minLength: 1,
    onChange: () => {},
    options: [],
    readOnly: false,
    required: false,
    value: null,
  },
  /** A textarea control's own props, for the two types the core keeps separate. */
  TEXTAREA_PROPS: ControlProps<"textarea"> = {
    code: "a",
    disabled: false,
    id: "field-a",
    maxLength: 40,
    onChange: () => {},
    options: [],
    readOnly: false,
    required: false,
    value: null,
  },
  /** A boolean control's own props, whose answer is never absent. */
  BOOLEAN_PROPS: ControlProps<"boolean"> = {
    code: "b",
    disabled: false,
    id: "field-b",
    onChange: () => {},
    options: [],
    readOnly: false,
    required: false,
    value: false,
  };

describe("the string a text or textarea control reports", () => {
  it("is the empty string itself for an empty field, and not the absence of one", () => {
    // The case the function exists for. `""` is a well-typed answer value to the
    // Core — `validate.json:1258` normalises an empty string without an
    // `INVALID_TYPE` — and whether it counts as *answered* is the core's
    // Question. A control that reported `null` here would answer it on the
    // Core's behalf, which is the inversion of `form-definition.ts:588`, where
    // The client refuses to convert because converting "would hide the error the
    // Caller needs to see".
    expect(textAnswerFrom("")).toBe("");
    expect(textAnswerFrom("")).not.toBeNull();
  });

  it("is a whitespace-only answer, unchanged, because trimming is a restriction", () => {
    // A space is a character the user typed, and `minLength` counts it. A
    // Control that trims would make `Field 't' must be at least 3 characters.`
    // (`validate.json:3846`) unreachable for an answer of spaces, and would
    // Report a different string than the one the user produced.
    expect(textAnswerFrom("   ")).toBe("   ");
    expect(textAnswerFrom("\t\n ")).toBe("\t\n ");
    expect(textAnswerFrom(" ")).not.toBe("");
  });

  it("is every other string exactly as it was typed", () => {
    // Including the answers the core rejects, which is the whole point: a
    // Control reports what the user produced and lets the core report on it.
    expect(textAnswerFrom("abc")).toBe("abc");
    expect(textAnswerFrom("AB1")).toBe("AB1");
    expect(textAnswerFrom("  padded  ")).toBe("  padded  ");
    expect(textAnswerFrom("0")).toBe("0");
    // `numberAnswerFrom`'s counterpart on the same input, so the difference
    // Between the two families is the difference in the core, not in the code:
    // `"0"` is a number here and an absent answer there.
    expect(textAnswerFrom("0")).not.toBe(Number(textAnswerFrom("0")));
  });

  it("is the same function for a textarea, which declares no property to derive from", () => {
    // A textarea declares `minLength` and `maxLength` and no more, so it has no
    // Constraints to take and the same answer to give. One implementation, not
    // A second one that could drift.
    const textareaAnswer = textAnswerFrom;
    expect(textareaAnswer("")).toBe("");
    expect(textareaAnswer("hello")).toBe("hello");
  });
});

describe("the constraints a string-like control declares", () => {
  it("stay distinct for a text and a textarea, so neither utility takes the other's field", () => {
    // `pattern` is the one property that separates the two types in the core's
    // Table, so it is the one that keeps the aliases apart. Both statements are
    // Type-level and both are checked at runtime, so a widening is a failing
    // Test as well as a build error.
    const textConstraints: TextConstraints = { maxLength: 5, pattern: "^[a-z]+$" },
      textareaConstraints: TextareaConstraints = { ...TEXTAREA_PROPS },
      borrowedProps = {
        ...TEXTAREA_PROPS,
        // @ts-expect-error a textarea declares no `pattern`, so the textarea's
        // Own props cannot take a text field's — the two types are not one type
        pattern: "^[a-z]+$",
      } satisfies ControlProps<"textarea">,
      distinct: Equal<TextConstraints, TextareaConstraints> = false;

    expect([textConstraints.pattern, textareaConstraints.maxLength, distinct]).toEqual([
      "^[a-z]+$",
      40,
      false,
    ]);
    expect(borrowedProps.pattern).toBe("^[a-z]+$");
  });

  it("refuse a number's constraints, because a number declares a `decimalPlaces`", () => {
    // The same statement the numeric tests make from the other side: every
    // Family types its parameters with its own alias, so a number field can
    // Never be handed to the string-like utilities. This is the compile-time
    // Statement; the runtime check is the value the @ts-expect-error line keeps.
    // @ts-expect-error `decimalPlaces` is not a text constraint
    const borrowed: TextConstraints = { decimalPlaces: 2, minLength: 1 };
    expect(borrowed).toEqual({ decimalPlaces: 2, minLength: 1 });
  });
});

describe("the boolean a checkbox reports", () => {
  it("is the state the box is actually in", () => {
    expect(checkedFrom(true)).toBe(true);
    expect(checkedFrom(false)).toBe(false);
  });

  it("is false for an absent answer, because a boolean has no absent state", () => {
    // `ControlChange<"boolean">` may not report `null`: an unchecked box is an
    // Answer, not a missing one. `ColanderBinding.value` is `unknown` because
    // The core's answers index holds unknown values, so a control must be able
    // To render before the document has said anything — and what it renders is
    // A box that is not ticked.
    expect(checkedFrom(null)).toBe(false);
    expect(checkedFrom()).toBe(false);
  });

  it("is false for anything that is not exactly `true`, and not a truthiness test", () => {
    // The distinction the old example's `value === true` got right and a
    // Truthiness test would get wrong: a checkbox is never "somewhat ticked",
    // And the string `"true"` is a different state that this control does not
    // Have. The core's own strictness about a string in a boolean field
    // (`type-error-boolean-string`, `Field 'patient.active' must be a
    // Boolean.`) is a validation of an answer arriving from outside a control.
    expect(checkedFrom("true")).toBe(false);
    expect(checkedFrom("")).toBe(false);
    expect(checkedFrom(1)).toBe(false);
    expect(checkedFrom(0)).toBe(false);
    expect(checkedFrom({})).toBe(false);
    expect(checkedFrom([])).toBe(false);
    expect(checkedFrom(Number.NaN)).toBe(false);
  });

  it("cannot report `null`, which is the host contract this function serves", () => {
    // The compile-time statement, with the runtime value checked beside it: the
    // Return type is what makes "an unchecked box is an answer" enforceable.
    // @ts-expect-error a boolean control may not report the absence of an answer
    const reported: ControlChange<"boolean"> = null;
    expect(checkedFrom(reported as unknown)).toBe(false);
  });
});

describe("the utility surface a control receives", () => {
  it("names the string decision once, for both string-like types", () => {
    const text: TextUtilities = { answerFrom: textAnswerFrom },
      textarea: TextareaUtilities = { answerFrom: textAnswerFrom };

    expect(text.answerFrom("")).toBe("");
    expect(textarea.answerFrom("abc")).toBe("abc");
    // The same object serves both, which is the statement that there is one
    // String decision and not two near-copies of it.
    expect(text.answerFrom).toBe(textarea.answerFrom);
  });

  it("names the boolean decision, and it takes no constraints to invent", () => {
    const boolean: BooleanUtilities = { checkedFrom };
    expect(boolean.checkedFrom(true)).toBe(true);
    expect(boolean.checkedFrom(null)).toBe(false);
  });

  it("is called with a control's own props, and the value is typed per type", () => {
    // The call shape a real control uses. A text control's props are already
    // Its constraints, a boolean's are not even that, and the answer function
    // Takes the raw string the element reports rather than the props.
    const textAnswer: string = textAnswerFrom(TEXT_PROPS.value ?? ""),
      textareaAnswer: string = textAnswerFrom(TEXTAREA_PROPS.value ?? ""),
      booleanAnswer: boolean = checkedFrom(BOOLEAN_PROPS.value);

    expect([textAnswer, textareaAnswer, booleanAnswer]).toEqual(["", "", false]);
  });
});
