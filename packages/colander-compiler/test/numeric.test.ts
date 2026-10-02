import { describe, expect, it } from "vitest";

import type { ControlProps } from "../src/contracts.js";
import { numberAnswerFrom, stepForInteger, stepForNumber } from "../src/utilities.js";
import type {
  IntegerConstraints,
  IntegerUtilities,
  NumberConstraints,
  NumberUtilities,
} from "../src/utilities.js";

/**
 * The numeric decisions, with the corpus line that decided each one in the
 * test that would fail without it.
 *
 * A per-type utility fails in the one way no reviewer notices: it is plausible,
 * it is close to what the neighbouring control does, and it constrains something
 * the core never said to constrain. So every case below is phrased as the claim
 * it defends rather than as the branch it exercises, and the two that differ
 * from the old example implementation are the reason this file exists at all.
 */

/** A number control's own props, which is what a control actually has to hand. */
const NUMBER_PROPS: ControlProps<"number"> = {
    code: "n",
    disabled: false,
    id: "field-n",
    onChange: () => {},
    options: [],
    readOnly: false,
    required: false,
    value: null,
  },
  /** The same field with the one property these cases are about. */
  NUMBER_PROPS_WITH_MULTIPLE: ControlProps<"number"> = {
    ...NUMBER_PROPS,
    multipleOf: 0.5,
  },
  /** An integer control's own props, and the same field with a declared multiple. */
  INTEGER_PROPS: ControlProps<"integer"> = {
    code: "i",
    disabled: false,
    id: "field-i",
    onChange: () => {},
    options: [],
    readOnly: false,
    required: false,
    value: null,
  };

/**
 * The call shape a real number control uses, written as a declaration because
 * this file is transformed as TSX, where a generic arrow's `<T>` would read as
 * a JSX element. The constraints alias takes the props object directly, so a
 * consumer never re-types a property to step by it.
 */
function stepForNumberControl(props: ControlProps<"number">): number | undefined {
  return stepForNumber(props);
}

/** The same call for an integer control, whose step is never absent. */
function stepForIntegerControl(props: ControlProps<"integer">): number {
  return stepForInteger(props);
}

describe("the granularity a number control steps by", () => {
  it("is the `multipleOf`, because the core enforces `multipleOf` on a number", () => {
    // `validate.json:4122` rejects `0.5` on a `number` field, so a step taken
    // From it rejects nothing the core was not already going to reject.
    expect(stepForNumber({ multipleOf: 0.5 })).toBe(0.5);
    expect(stepForNumber({ multipleOf: 2 })).toBe(2);
  });

  it("falls back to the precision `decimalPlaces` declares, as a hint and not a rule", () => {
    // `decimalPlaces` appears zero times in the validation corpus: the core
    // States nothing about it, so this is the control's own suggestion.
    expect(stepForNumber({ decimalPlaces: 0 })).toBe(1);
    expect(stepForNumber({ decimalPlaces: 2 })).toBe(0.01);
  });

  it("prefers the enforced rule over the hint when a field declares both", () => {
    // A field declaring `multipleOf: 0.25` and `decimalPlaces: 0` says the
    // Granularity twice; the enforced one is the one that cannot be wrong.
    expect(stepForNumber({ decimalPlaces: 0, multipleOf: 0.25 })).toBe(0.25);
  });

  it("is absent, not one, when the field declares nothing usable", () => {
    // `undefined` and `1` are different answers: a control that cannot tell
    // Them apart will put a step on an element the document never asked to step.
    const declared: NumberConstraints = { maximum: 10, minimum: 0 };
    expect(stepForNumber(declared)).toBeUndefined();
    expect(stepForNumber({})).toBeUndefined();
    expect(stepForNumber({})).not.toBe(1);
  });

  it("refuses a `multipleOf` that is not a positive finite number", () => {
    // None of these can be a granularity, and handing any of them to an element
    // Would be inventing a constraint out of a value the document got wrong.
    expect(stepForNumber({ multipleOf: 0 })).toBeUndefined();
    expect(stepForNumber({ multipleOf: -2 })).toBeUndefined();
    expect(stepForNumber({ multipleOf: Number.NaN })).toBeUndefined();
    expect(stepForNumber({ multipleOf: Number.POSITIVE_INFINITY })).toBeUndefined();
  });

  it("refuses a `decimalPlaces` that describes no precision at all", () => {
    // A negative one would step backwards and a fractional one is not a number
    // Of digits; neither is turned into a `10 **` of itself.
    expect(stepForNumber({ decimalPlaces: -1 })).toBeUndefined();
    expect(stepForNumber({ decimalPlaces: 1.5 })).toBeUndefined();
    expect(stepForNumber({ decimalPlaces: Number.NaN })).toBeUndefined();
  });

  it("is taken from a control's own props with no cast and no re-declaration", () => {
    expect(stepForNumberControl(NUMBER_PROPS_WITH_MULTIPLE)).toBe(0.5);
    expect(stepForNumberControl(NUMBER_PROPS)).toBeUndefined();
  });
});

describe("the granularity an integer control steps by", () => {
  it("is one whenever the field declares nothing, because it is never absent", () => {
    expect(stepForInteger({})).toBe(1);
    expect(stepForInteger({ maximum: 4, minimum: 0 })).toBe(1);
  });

  it("is the `multipleOf` whenever stepping by it can only produce whole units", () => {
    // A whole number lands on a whole unit without any division, and a fraction
    // Reaches one only when one divided by it is itself whole: two, five, a
    // Half, a quarter and a tenth each satisfy one of those two statements.
    expect(stepForInteger({ multipleOf: 2 })).toBe(2);
    expect(stepForInteger({ multipleOf: 5 })).toBe(5);
    expect(stepForInteger({ multipleOf: 0.5 })).toBe(0.5);
    expect(stepForInteger({ multipleOf: 0.25 })).toBe(0.25);
    // The float caveat, stated rather than hidden: `1 / 0.1` is exactly `10` in
    // IEEE 754, so a tenth is honoured. The test says so because that is a fact
    // About doubles, not a fact about the core.
    expect(1 / 0.1).toBe(10);
    expect(stepForInteger({ multipleOf: 0.1 })).toBe(0.1);
  });

  it("is one for a `multipleOf` that would not land on whole units", () => {
    // The corpus is why this rule exists at all: `validate.json:4232` and
    // `:4281` both declare `"multipleOf": 0.5` on an `integer` and both return
    // Zero errors, so the core accepts a `multipleOf` there and never enforces
    // It. `0.5` is still safe to step by because it lands on whole units, but a
    // `0.3` step would make `2` unreachable from the keyboard while the core
    // Accepts `2` for that very field. The core's silence is answered with the
    // Non-restrictive step.
    expect(stepForInteger({ multipleOf: 0.3 })).toBe(1);
    expect(stepForInteger({ multipleOf: 0.7 })).toBe(1);
    expect(stepForInteger({ multipleOf: 0 })).toBe(1);
    expect(stepForInteger({ multipleOf: -2 })).toBe(1);
    expect(stepForInteger({ multipleOf: Number.NaN })).toBe(1);
    expect(stepForInteger({ multipleOf: Number.POSITIVE_INFINITY })).toBe(1);
  });

  it("is taken from an integer control's own props, which are the integer's constraints", () => {
    // The same statement for the other type, and the reason the two utilities
    // Have different parameter types: each control's props are already exactly
    // What its own step takes.
    expect(stepForIntegerControl({ ...INTEGER_PROPS, multipleOf: 0.25 })).toBe(0.25);
    expect(stepForIntegerControl(INTEGER_PROPS)).toBe(1);
  });

  it("cannot be handed a `decimalPlaces`, because an integer field declares none", () => {
    // A number's constraints are not an integer's: `decimalPlaces` is the one
    // Property that separates the two types, so this is the type-level
    // Statement that the integer step is not the number step under another name.
    // @ts-expect-error an integer field declares no `decimalPlaces`
    const borrowed: IntegerConstraints = { decimalPlaces: 2, multipleOf: 2 },
      // The function that may answer `undefined` cannot stand in for the one whose
      // Step is always present.
      // @ts-expect-error `stepForNumber` may return `undefined`
      borrowedStep: (constraints: IntegerConstraints) => number = stepForNumber;
    expect([borrowed.multipleOf, borrowedStep({ multipleOf: 2 })]).toStrictEqual([2, 2]);
  });
});

describe("the number the core is to validate", () => {
  it("is nothing at all for an empty field, which is not the same as zero", () => {
    expect(numberAnswerFrom("")).toBeNull();
    expect(numberAnswerFrom("   ")).toBeNull();
    expect(numberAnswerFrom("\t\n ")).toBeNull();
  });

  it("is zero for a field answered with zero, which is why the empty case is null", () => {
    // This is the case the `null` exists to keep distinct. Reporting `0` for an
    // Empty field would make an unanswered required field look answered.
    expect(numberAnswerFrom("0")).toBe(0);
    expect(numberAnswerFrom(" 0 ")).toBe(0);
    expect(numberAnswerFrom("0")).not.toBeNull();
  });

  it("is the parsed number for what the user actually typed", () => {
    expect(numberAnswerFrom("42")).toBe(42);
    expect(numberAnswerFrom("-7.5")).toBe(-7.5);
    expect(numberAnswerFrom("1e3")).toBe(1000);
  });

  it("is nothing for a string that is not a number, and nothing for an overflow", () => {
    // `NaN` and `Infinity` are answers of the wrong shape; the core would have
    // To reject them as a type error, and it can only do that if they are seen.
    expect(numberAnswerFrom("abc")).toBeNull();
    expect(numberAnswerFrom("1e999")).toBeNull();
    expect(numberAnswerFrom("Infinity")).toBeNull();
    expect(numberAnswerFrom("-1e999")).toBeNull();
  });

  it("keeps a fractional answer whole-handed, because the core is strict on purpose", () => {
    // `form-definition.ts:588` refuses to convert a string in a `number` field
    // Because it "would hide the error the caller needs to see". A control that
    // Rounded here would make that error unreachable, so `2.7` is reported as
    // `2.7` and the integer case is the step's job, not this function's.
    expect(numberAnswerFrom("2.7")).toBe(2.7);
    expect(numberAnswerFrom("2.7")).not.toBe(3);
  });

  it("is the same function for an integer control, and does not round there either", () => {
    // An `integer` field declaring `multipleOf: 0.5` is accepted by the core, so
    // The client is the only place a fractional answer is still visible. Rounding
    // It here would hide it from the one party that can see it.
    const integerAnswer = numberAnswerFrom;
    expect(integerAnswer("2.7")).toBe(2.7);
    expect(integerAnswer("")).toBeNull();
  });

  it("returns the answer rather than reporting it, so the caller still sees it", () => {
    // A callback-taking `reportNumber` hid the answer inside the utility. This
    // Is the difference the old example's shape made impossible to observe.
    const reported: number | null = numberAnswerFrom("3");
    expect(reported).toBe(3);
  });
});

describe("the utility surface a control receives", () => {
  it("names its own step and answer, with the parameters its own type declares", () => {
    // The interfaces are what the registry will key by type, and the two are
    // Not interchangeable: an integer's step cannot be absent and cannot take a
    // `decimalPlaces`, which is the whole reason the number utility is separate.
    const numberUtilities: NumberUtilities = { answerFrom: numberAnswerFrom, step: stepForNumber },
      integerUtilities: IntegerUtilities = {
        answerFrom: numberAnswerFrom,
        step: stepForInteger,
      };

    expect(numberUtilities.step({ multipleOf: 0.5 })).toBe(0.5);
    expect(numberUtilities.answerFrom("1.5")).toBe(1.5);
    expect(integerUtilities.step({ multipleOf: 0.3 })).toBe(1);
    expect(integerUtilities.answerFrom("1.5")).toBe(1.5);
  });
});
