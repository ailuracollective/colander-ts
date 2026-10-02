import type { Field } from "@ailura/colander-client";
import { materializableTypes } from "@ailura/colander-client/semantics";
import { describe, expect, it } from "vitest";

import type { ControlProps } from "../src/contracts.js";
import type { MaterializableFieldType } from "../src/plan.js";
import { controlPropsFor } from "../src/runtime.js";
import {
  MIDNIGHT,
  typeUtilities,
  choiceAnswerFrom,
  choiceControlValue,
  choiceEmptyValue,
  choiceHas,
  checkedFrom,
  dateAnswerFrom,
  dateTimeAnswerFrom,
  formatDateAnswer,
  formatDateTimeAnswer,
  formatTimeAnswer,
  numberAnswerFrom,
  parseDateAnswer,
  stepForInteger,
  stepForNumber,
  textAnswerFrom,
  timeAnswerFrom,
  unansweredChoiceValue,
  unansweredValueFor,
} from "../src/utilities.js";
import type {
  DateTimeUtilities,
  DateUtilities,
  IntegerConstraints,
  IntegerUtilities,
  NumberConstraints,
  NumberUtilities,
  TimeUtilities,
  TypeUtilities,
  UtilitiesOf,
  BooleanUtilities,
  ChoiceUtilities,
  TextUtilities,
} from "../src/utilities.js";

/**
 * The registry's two claims, with the failure each case would catch named in
 * the test that would fail without it.
 *
 * The registry exists to remove two things the example app had: a per-control
 * import of whichever family module happened to hold what the control needed,
 * and a list of the core's vocabulary written down somewhere that could go
 * stale. The second is the one that fails silently, because a stale list is
 * still a compiling object — it is just missing a type, and the control that
 * looks that type up is the one that breaks. So the expected list of types is
 * derived from the core's own table on every run of this file, and a tenth
 * materializable type fails the suite before it can fail a consumer.
 *
 * The other claim is the mirror image, and it is a compile-time one: a type
 * added to the core's table without a utilities entry is a build error in this
 * package, not a `undefined` a control would meet later.
 */

/**
 * The identity these cases use, rather than a list of assertions.
 *
 * A registry entry is wrong in a way no runtime assertion can see: it is wrong
 * when a member is wired to a neighbouring type's function, and right enough at
 * runtime to return a plausible answer. Every compile-time claim below is
 * therefore paired with a runtime check of its value, so a drift shows up as
 * either a failing build or a failing test rather than as a silent mismatch.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** A number field's props, which is what a control actually has to hand. */
const NUMBER_PROPS: ControlProps<"number"> = {
  code: "n",
  decimalPlaces: 2,
  disabled: false,
  id: "field-n",
  multipleOf: 0.5,
  onChange: () => {},
  options: [],
  readOnly: false,
  required: false,
  value: null,
};

describe("the registry's keys", () => {
  it("are every type the core says a control can be generated for", () => {
    // The expected list is `materializableTypes()` rather than nine names, and
    // That is the load-bearing part of this case: a type added to the core's
    // Table lands in the expectation here and in the mapped type in
    // `registry.ts`, and fails this test and that build rather than producing
    // An entry the core promises and the registry does not have.
    const keys = Object.keys(typeUtilities).sort();
    expect(keys).toEqual([...materializableTypes()].sort());
  });

  it("carry the type's own name, so an entry says what it is for", () => {
    // A consumer holding one entry — a generator's output, a props object, a
    // Value it picked up from somewhere else — must not have to remember which
    // Key it came from in order to know what it is for.
    for (const type of materializableTypes()) {
      expect(typeUtilities[type].type).toBe(type);
    }
  });

  it("leave no type without an entry, which is the failure the mapped type prevents", () => {
    // Two statements of one claim. The `satisfies` fails to compile if a key is
    // Missing from the registry, and the runtime count fails if the value is
    // Ever assembled dynamically instead of written out — which is the one way
    // An exhaustive *type* could stop matching an exhaustive *object*.
    const exhaustive = {
        boolean: true,
        choice: true,
        date: true,
        datetime: true,
        integer: true,
        number: true,
        text: true,
        textarea: true,
        time: true,
      } satisfies Record<MaterializableFieldType, true>,
      missing: Exclude<MaterializableFieldType, keyof TypeUtilities> = undefined as never,
      noTypeMissesItsUtilities: Equal<
        Exclude<MaterializableFieldType, keyof typeof typeUtilities>,
        never
      > = true;

    expect([Object.keys(exhaustive).length, noTypeMissesItsUtilities, missing]).toEqual([
      materializableTypes().length,
      true,
      undefined,
    ]);
  });
});

describe("the two numeric steps, reached through the registry", () => {
  it("are two different functions, not one answer under two names", () => {
    // The whole reason the member type is a conditional on the key. A registry
    // Typed as a union of interfaces would hand both controls the same pair of
    // Members, and this identity would be the one reader who noticed.
    expect(typeUtilities.number.step).not.toBe(typeUtilities.integer.step);
    expect(typeUtilities.number.step).toBe(stepForNumber);
    expect(typeUtilities.integer.step).toBe(stepForInteger);
  });

  it("type their parameter as the type each is for, so neither takes the other's field", () => {
    // A `number` field declares `decimalPlaces` and an `integer` field does not,
    // And the corpus is why that difference is a decision rather than an
    // Oversight: `multipleOf: 0.5` on an integer is accepted and never
    // Enforced, so an integer control cannot step by a number's step.
    //
    // The same absence stated at the call, on a fresh literal: `decimalPlaces`
    // Is a property a number field carries and an integer field does not, so a
    // Number field's props written out inline is not an integer's constraints.
    // Written inline on purpose — a variable carrying extra properties is still
    // Assignable, so it is the literal that proves the two types differ.
    const numberPropsThroughIntegerStep = typeUtilities.integer.step({
        multipleOf: 0.5,
        // @ts-expect-error the same absence, stated at the property that has it
        decimalPlaces: 2,
      }),
      // @ts-expect-error the number step is handed a number's constraints, and a
      // Bare string is not a constraints object however plausible it looks
      stringThroughNumberStep = typeUtilities.number.step("multipleOf: 0.5"),
      // And the two parameter types, named, because a fresh-literal rejection is
      // One direction of the claim and this is the other: the integer step returns
      // A step for every integer field while the number step may decline, and
      // Neither signature can be passed where the other is expected.
      integerStep: Equal<
        typeof typeUtilities.integer.step,
        (constraints: IntegerConstraints) => number
      > = true,
      numberStep: Equal<
        typeof typeUtilities.number.step,
        (constraints: NumberConstraints) => number | undefined
      > = true;

    // `0.5` is honoured rather than refused: one divided by it is whole, so
    // Stepping by it can only produce whole units. The `decimalPlaces` above is
    // What the compiler rejects, not the `multipleOf` beside it.
    expect([numberPropsThroughIntegerStep, stringThroughNumberStep]).toEqual([0.5, undefined]);
    expect([numberStep, integerStep]).toEqual([true, true]);
  });

  it("are the two types' own interfaces, not a widened merge of them", () => {
    const integer: Equal<
        typeof typeUtilities.integer,
        { readonly type: "integer" } & IntegerUtilities
      > = true,
      number: Equal<typeof typeUtilities.number, { readonly type: "number" } & NumberUtilities> =
        true;
    expect([number, integer]).toEqual([true, true]);
  });
});

describe("each entry's members", () => {
  it("are the exported functions themselves, for the numeric family", () => {
    // Identity, not equality: a member re-declared inside the registry would
    // Behave identically today and drift the first time the family module's
    // Rule changed, and the registry is the copy every control would call.
    expect(typeUtilities.number.answerFrom).toBe(numberAnswerFrom);
    expect(typeUtilities.integer.answerFrom).toBe(numberAnswerFrom);
    expect(typeUtilities.integer.step).toBe(stepForInteger);
  });

  it("are the exported functions themselves, for the text and boolean families", () => {
    expect(typeUtilities.text.answerFrom).toBe(textAnswerFrom);
    expect(typeUtilities.textarea.answerFrom).toBe(textAnswerFrom);
    expect(typeUtilities.boolean.checkedFrom).toBe(checkedFrom);
  });

  it("are the exported functions themselves, for the choice family", () => {
    const { choice } = typeUtilities;
    expect([
      choice.emptyValue,
      choice.controlValue,
      choice.answerFrom,
      choice.has,
      choice.unansweredValue,
    ]).toEqual([
      choiceEmptyValue,
      choiceControlValue,
      choiceAnswerFrom,
      choiceHas,
      unansweredChoiceValue,
    ]);
  });

  it("reach every materializable type, and no other, by key", () => {
    // The runtime half of the exhaustiveness the mapped type enforces at build
    // Time: a consumer iterating the core's types must find an entry for each
    // One, and a lookup for a name the core does not declare must not be
    // Answered by one of them. The build-time half is in `src/utilities/
    // Registry.ts`, where `tsc -b` reads it; this is the fact it protects.
    expect(Object.keys(typeUtilities).sort()).toEqual([...materializableTypes()].sort());
    for (const type of materializableTypes()) {
      expect(typeUtilities[type].type).toBe(type);
    }
  });

  it("are the exported functions themselves, for the temporal family", () => {
    const { date } = typeUtilities,
      { time } = typeUtilities,
      { datetime } = typeUtilities;
    expect([date.formatAnswer, date.parseAnswer, date.answerFrom]).toEqual([
      formatDateAnswer,
      parseDateAnswer,
      dateAnswerFrom,
    ]);
    expect([time.formatAnswer, time.answerFrom]).toEqual([formatTimeAnswer, timeAnswerFrom]);
    expect([datetime.midnight, datetime.formatAnswer, datetime.answerFrom]).toEqual([
      MIDNIGHT,
      formatDateTimeAnswer,
      dateTimeAnswerFrom,
    ]);
  });

  it("leave the types that declare nothing to a member of their own", () => {
    // The shape is ragged on purpose and these are the four facts that keep it
    // Ragged honestly: a `boolean` control has no `step` because the core
    // Declares no property to step by, and padding it with a member returning
    // `undefined` would be a promise the type system cannot keep.
    const exact: Equal<keyof typeof typeUtilities.boolean, "type" | "checkedFrom"> = true,
      noStepOnBoolean: Equal<keyof typeof typeUtilities.boolean, "step"> = false;
    expect([exact, noStepOnBoolean]).toEqual([true, false]);
  });
});

describe("the two string-like entries", () => {
  it("are two entries holding one decision, because the key is the type", () => {
    // `textarea` gets its own key because the core keeps the two types apart
    // And a consumer iterating the core's types must not get `undefined` for a
    // Type the core declares. The entries are two objects rather than one
    // Because each carries the name of the type it was looked up as, and an
    // Entry that claimed `"text"` while sitting under the `textarea` key would
    // Be the entry that lies. The decision itself is shared: one function, one
    // Identity, asserted below.
    expect(typeUtilities.text.type).toBe("text");
    expect(typeUtilities.textarea.type).toBe("textarea");
    expect(typeUtilities.text).not.toBe(typeUtilities.textarea);
    expect(typeUtilities.text.answerFrom).toBe(typeUtilities.textarea.answerFrom);
  });

  it("both answer, which is the point of a textarea having a key", () => {
    // The corpus is why this is thin: a `text` field declares `minLength`,
    // `maxLength` and `pattern`, a `textarea` the first two, and all of them
    // Arrive under their own names, so there is nothing to derive. What is left
    // Is the answer, and for both types it is the string the user typed.
    expect(typeUtilities.text.answerFrom("")).toBe("");
    expect(typeUtilities.textarea.answerFrom("")).toBe("");
    expect(typeUtilities.textarea.answerFrom("  padded  ")).toBe("  padded  ");
  });

  it("type as the alias the family module states the two share", () => {
    const text: Equal<typeof typeUtilities.text, { readonly type: "text" } & TextUtilities> = true,
      textarea: Equal<UtilitiesOf<"textarea">, TextUtilities> = true;
    expect([text, textarea]).toEqual([true, true]);
  });
});

describe("a control reading a compiled field", () => {
  it("finds the utilities by the type on the entry, not by an import it chose", () => {
    // The end-to-end claim, and the reason the entry carries its type at all: a
    // Generated control reads its field's declared properties, hands them to the
    // Step the entry names, and reports the answer the same entry derives. The
    // Cast is the one a generated module would not need — there the props are
    // Typed by the contract rather than read back as a loose record.
    const field: Field = {
        code: "n",
        decimalPlaces: 2,
        multipleOf: 0.5,
        type: "number",
      },
      utilities = utilitiesFor("number"),
      props = propsFor(utilities.type, field);

    expect(utilities.type).toBe("number");
    expect(utilities.step(props)).toBe(0.5);
    expect(utilities.answerFrom("1.25")).toBe(1.25);
  });

  it("steps an integer field by the integer rule the corpus decided, not the number one", () => {
    // Same declared `multipleOf`, two answers, and the difference is the core's
    // Rather than the registry's. `validate.json:4232` and `:4281` both declare
    // A `multipleOf` on an `integer` and both return zero errors, so the core
    // Never enforces it there: a `0.3` step would make the element refuse
    // Integers the core accepts, so the integer entry steps by one and the
    // Number entry — where the core *does* enforce `multipleOf` — steps by it.
    const field: Field = { code: "i", multipleOf: 0.3, type: "integer" },
      utilities = utilitiesFor("integer"),
      props = propsFor(utilities.type, field);

    expect(utilities.step(props)).toBe(1);
    expect(typeUtilities.number.step({ multipleOf: 0.3 })).toBe(0.3);
  });

  it("carries the number field's own props to the same answer as a hand-built one", () => {
    // The field literal and the hand-built props object describe the same
    // Field, so the registry's two steps must agree on both. This is the case
    // That would fail if the wiring read a property the field never declared.
    const field: Field = { code: "n", decimalPlaces: 2, multipleOf: 0.5, type: "number" },
      fromField = typeUtilities.number.step(propsFor(typeUtilities.number.type, field));
    expect(fromField).toBe(typeUtilities.number.step(NUMBER_PROPS));
  });
});

describe("the temporal entries, which a control reads without a family import", () => {
  it("resolve to their own interfaces, not to one temporal union", () => {
    const boolean: Equal<
        typeof typeUtilities.boolean,
        { readonly type: "boolean" } & BooleanUtilities
      > = true,
      choice: Equal<typeof typeUtilities.choice, { readonly type: "choice" } & ChoiceUtilities> =
        true,
      date: Equal<typeof typeUtilities.date, { readonly type: "date" } & DateUtilities> = true,
      datetime: Equal<
        typeof typeUtilities.datetime,
        { readonly type: "datetime" } & DateTimeUtilities
      > = true,
      time: Equal<typeof typeUtilities.time, { readonly type: "time" } & TimeUtilities> = true;
    expect([date, time, datetime, boolean, choice]).toEqual([true, true, true, true, true]);
  });

  it("hold a `midnight` value rather than a function, because it is a value", () => {
    // The one member in the package that is not a function, and the reason the
    // Conditional's family interfaces cannot be flattened: `datetime` is asked
    // For a value, every other member is asked to do something.
    expect(typeUtilities.datetime.midnight).toEqual({ hours: 0, minutes: 0 });
  });
});

/**
 * Look a type up in the registry from a value that is only known at runtime,
 * the way a generated control does when it is handed a leaf's type.
 *
 * Written as a function declaration because this file is transformed as TSX,
 * where a generic arrow's `<T>` would read as a JSX element — the same reason
 * `test/numeric.test.ts` declares its call shapes rather than writing arrows.
 * The result is still per-type rather than a union, which is the point: a
 * control that knows its type knows the members it has.
 */
function utilitiesFor<T extends MaterializableFieldType>(
  type: T,
): { readonly type: T } & UtilitiesOf<T> {
  return typeUtilities[type];
}

/**
 * The props a generated control receives: the core's context, plus the
 * properties this type declares, read off a compiled field.
 *
 * `controlPropsFor` returns a loose record because it is handed a type as a
 * string. A generated module never sees that record — its control is typed by
 * the contract — so the cast here is the generated typing, written out once
 * rather than by a build.
 */
function propsFor<T extends MaterializableFieldType>(type: T, field: Field): ControlProps<T> {
  return {
    code: field.code ?? "",
    disabled: false,
    id: field.id ?? field.code ?? "",
    onChange: () => {},
    options: field.options ?? [],
    readOnly: field.readOnly ?? false,
    required: field.required ?? false,
    value: null,
    ...controlPropsFor(type, field),
  } as unknown as ControlProps<T>;
}
