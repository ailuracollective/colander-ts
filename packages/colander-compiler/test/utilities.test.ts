import { describe, expect, it } from "vitest";

import type { ControlProps } from "../src/contracts.js";
import type { MaterializableFieldType } from "../src/plan.js";
import { DERIVATION_RULE } from "../src/utilities.js";
import type {
  ChoiceConstraints,
  DeclaredProperties,
  IntegerConstraints,
  NumberConstraints,
  TextareaConstraints,
  TextConstraints,
} from "../src/utilities.js";

/**
 * The identity these cases use, rather than a list of assertions.
 *
 * A constraint type is wrong in a way no runtime assertion can see: it is wrong
 * when a name is missing, when one is extra, or when one carries the wrong
 * TypeScript type. Every case below is therefore a compile-time statement whose
 * value is also checked at runtime, so a drift in the core's table shows up
 * either as a failing build or as a failing test, never as a silent widening.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The names a constraints type carries, as a union, so a set can be compared. */
type Names<T> = Extract<keyof T, string>;

/** A number field's props, built once, because a control is handed exactly this. */
const numberProps: ControlProps<"number"> = {
  code: "n",
  disabled: false,
  id: "field-n",
  onChange: () => {},
  options: [],
  readOnly: false,
  required: false,
  value: null,
};

describe("the properties a number field declares", () => {
  it("are the core's four, in the core's order, and not the shell's two", () => {
    const exact: Equal<
      Names<DeclaredProperties<"number">>,
      "minimum" | "maximum" | "multipleOf" | "decimalPlaces"
    > = true;
    expect(exact).toBe(true);
  });

  it("are optional numbers, because a document may declare none of them", () => {
    const decimalPlaces: Equal<NumberConstraints["decimalPlaces"], number | undefined> = true,
      minimum: Equal<NumberConstraints["minimum"], number | undefined> = true;
    expect([minimum, decimalPlaces]).toEqual([true, true]);
  });

  it("refuse a value the core would not accept for them", () => {
    // @ts-expect-error the core declares `minimum` as a number; a string is a
    // Control's markup decision, not a constraint it may hand the utility
    const notAString: NumberConstraints["minimum"] = "0";
    expect(notAString).toBe("0");
  });

  it("carry neither `title` nor `description`, because the shell renders those", () => {
    // @ts-expect-error the shell owns `title`; it is not a constraint
    const title: NumberConstraints["title"] = undefined,
      // @ts-expect-error the shell owns `description`; it is not a constraint
      description: NumberConstraints["description"] = undefined;
    expect([title, description]).toEqual([undefined, undefined]);
  });
});

describe("the properties an integer field declares", () => {
  it("are the core's three, and not a number's four", () => {
    const exact: Equal<
      Names<DeclaredProperties<"integer">>,
      "minimum" | "maximum" | "multipleOf"
    > = true;
    expect(exact).toBe(true);
  });

  it("have no `decimalPlaces`, which is what makes the integer step undecidable", () => {
    // The corpus accepts `multipleOf: 0.5` on an integer and never rejects it,
    // So a step derived the way a number's is would reject integers the core
    // Accepts. Pinning the absence is what keeps that step from being written.
    // @ts-expect-error the core declares no `decimalPlaces` on an integer
    const decimalPlaces: IntegerConstraints["decimalPlaces"] = 2;
    expect(decimalPlaces).toBe(2);
  });

  it("are not interchangeable with a number's, so neither utility takes the other's field", () => {
    // @ts-expect-error a number's `decimalPlaces` is not something an integer
    // Field carries, so the number utilities cannot be handed an integer's props
    const borrowed: IntegerConstraints = { decimalPlaces: 2 };
    expect(borrowed).toEqual({ decimalPlaces: 2 });
  });
});

describe("the properties the string-like types declare", () => {
  it("are `minLength`, `maxLength` and `pattern` for a text", () => {
    const exact: Equal<
      Names<DeclaredProperties<"text">>,
      "minLength" | "maxLength" | "pattern"
    > = true;
    expect(exact).toBe(true);
  });

  it("are `minLength` and `maxLength` for a textarea, which the core keeps separate", () => {
    const exact: Equal<Names<DeclaredProperties<"textarea">>, "minLength" | "maxLength"> = true;
    expect(exact).toBe(true);
  });

  it("are `allowMultiple` alone for a choice", () => {
    const exact: Equal<Names<DeclaredProperties<"choice">>, "allowMultiple"> = true;
    expect(exact).toBe(true);
  });

  it("are none at all for a boolean, which is why its utility takes no constraints", () => {
    // The core declares no property for `boolean` beyond the shell's two, so an
    // Empty constraints type would accept anything and mean nothing by it. The
    // Absence is the contract: the utility is called with the field's context.
    const exact: Equal<Names<DeclaredProperties<"boolean">>, never> = true;
    expect(exact).toBe(true);
  });
});

describe("a control calling a utility with its own props", () => {
  it("needs no cast, because the props it is handed are already the constraints", () => {
    // This line is the check. A control receives the core's context too, but a
    // Function taking only the constraints accepts the props object directly,
    // So a consumer never re-declares a property's type to call a utility.
    const constraintsFor = (props: ControlProps<"number">): NumberConstraints => props;
    expect(constraintsFor(numberProps)).toBe(numberProps);
  });

  it("accepts the same for a text, a textarea, a choice and an integer", () => {
    // Each props object is checked against the control contract, and each
    // Constraints alias then takes it with no cast and no intermediate type.
    const textProps = {
        code: "t",
        disabled: false,
        id: "field-t",
        minLength: 1,
        onChange: () => {},
        options: [],
        readOnly: false,
        required: false,
        value: null,
      } satisfies ControlProps<"text">,
      textareaProps = {
        code: "a",
        disabled: false,
        id: "field-a",
        maxLength: 40,
        onChange: () => {},
        options: [],
        readOnly: false,
        required: false,
        value: null,
      } satisfies ControlProps<"textarea">,
      choiceProps = {
        allowMultiple: true,
        code: "c",
        disabled: false,
        id: "field-c",
        onChange: () => {},
        options: [],
        readOnly: false,
        required: false,
        value: [],
      } satisfies ControlProps<"choice">,
      integerProps = {
        code: "i",
        disabled: false,
        id: "field-i",
        multipleOf: 1,
        onChange: () => {},
        options: [],
        readOnly: false,
        required: false,
        value: null,
      } satisfies ControlProps<"integer">,
      asText: TextConstraints = textProps,
      asTextarea: TextareaConstraints = textareaProps,
      asChoice: ChoiceConstraints = choiceProps,
      asInteger: IntegerConstraints = integerProps;

    expect([
      asText.minLength,
      asTextarea.maxLength,
      asChoice.allowMultiple,
      asInteger.multipleOf,
    ]).toEqual([1, 40, true, 1]);
  });

  it("resolves generically, so a function over any type compiles and works", () => {
    // The generic form is what a family utility's signature looks like: written
    // Once against the type reader, and still able to take a concrete field's
    // Props when the caller knows the type.
    function acceptsDeclared<T extends MaterializableFieldType>(
      properties: DeclaredProperties<T>,
    ): void {
      void properties;
    }
    acceptsDeclared<"number">(numberProps);
    expect(true).toBe(true);
  });
});

describe("the rule the utilities obey", () => {
  it("is the literal its documentation names", () => {
    // The rule is a string rather than only a doc comment so that a reader, a
    // Test and a later work unit all quote the same one instead of three
    // Paraphrases of it.
    expect(DERIVATION_RULE).toBe("core-declares");
  });
});
