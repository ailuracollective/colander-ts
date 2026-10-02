import type { FieldOption } from "@ailura/colander-client";
import { describe, expect, it } from "vitest";

import type { ControlProps } from "../src/contracts.js";
import {
  choiceAnswerFrom,
  choiceControlValue,
  choiceEmptyValue,
  choiceHas,
  unansweredChoiceValue,
} from "../src/utilities.js";
import type { ChoiceUtilities } from "../src/utilities.js";

/**
 * The two answer shapes a `choice` can have, and the translation between them
 * and a one-value widget.
 *
 * A choice's answer is **not one shape**. The core decides it per field, from
 * `allowMultiple`, and it decides it strictly in both directions — quoted from
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
 * So a single-select answers with a scalar and a multiple with a list, and each
 * rejects the other's shape. This file used to assert the opposite — that
 * `choiceAnswerFrom` returns a list whatever the field declares — and the app's
 * control shipped a `["red"]` for a dropdown, which the core answered with
 * *must be a choice value*. Every case below is one of those, in one direction
 * or the other.
 *
 * The type-level half of this contract is **not** here, and that is deliberate.
 * The package's `tsconfig.json` includes `src/**` and `tsconfig.test.json` is
 * not part of the build, so an assertion in this directory is enforced by no
 * command in the repository's verification. The `@ts-expect-error` proofs that a
 * single-select's `onChange` rejects a list, and a multiple's rejects a scalar,
 * live in `src/contracts.ts` where `tsc -b` reads them on every build.
 */

/** The two options the corpus's `patient.color` field offers. */
const COLOR_OPTIONS: readonly FieldOption[] = [
    { label: "Red", value: "red" },
    { label: "Blue", value: "blue" },
  ],
  /** A choice control's own props, which carry the options the core published. */
  CHOICE_PROPS: ControlProps<"choice"> = {
    allowMultiple: false,
    code: "patient.color",
    disabled: false,
    id: "field-c",
    onChange: () => {},
    options: COLOR_OPTIONS,
    readOnly: false,
    required: false,
    value: null,
  },
  /** The sentinel the old example wrote down, as a fact about that example. */
  OLD_EMPTY = "__colander_no_answer__";

describe("the value that means nothing is selected", () => {
  it("is not one of the options of a field that has some", () => {
    // The property the whole function exists for. A sentinel equal to an
    // Option's value renders as though that option were chosen, and the control
    // Then reports it as the answer.
    const empty = choiceEmptyValue(COLOR_OPTIONS);
    expect(COLOR_OPTIONS.map((option) => option.value)).not.toContain(empty);
  });

  it("is not one of the options of a field that has none", () => {
    // A field with no options is the case where the old sentinel was
    // Accidentally correct, and it is here so the empty case is not the one
    // That gives the function its confidence.
    expect(choiceEmptyValue([])).not.toBe("");
    expect(choiceEmptyValue([])).toBe(OLD_EMPTY);
  });

  it("is the same value every time the same options are given", () => {
    // A control re-derives this on every render. A value that changed between
    // Renders would change the control's own selection underneath itself, and
    // Nothing else in the form would have changed to explain it.
    expect(choiceEmptyValue(COLOR_OPTIONS)).toBe(choiceEmptyValue(COLOR_OPTIONS));
    expect(choiceEmptyValue(COLOR_OPTIONS)).toBe(OLD_EMPTY);
  });

  it("steps past a collision, and past every length of it", () => {
    // The defect, at every length it can take. A field offering the base name
    // Needs the next one; a field offering the base name *and* the first
    // Extension needs the second. A rule that only handled the first case would
    // Have replaced one wrong selection with another.
    const withBase: readonly FieldOption[] = [{ value: OLD_EMPTY }, { value: "red" }],
      withFirstExtension: readonly FieldOption[] = [
        { value: OLD_EMPTY },
        { value: `${OLD_EMPTY}1` },
      ],
      withBothExtensions: readonly FieldOption[] = [
        { value: OLD_EMPTY },
        { value: `${OLD_EMPTY}1` },
        { value: `${OLD_EMPTY}2` },
      ];

    expect(choiceEmptyValue(withBase)).toBe(`${OLD_EMPTY}1`);
    expect(choiceEmptyValue(withFirstExtension)).toBe(`${OLD_EMPTY}2`);
    expect(choiceEmptyValue(withBothExtensions)).toBe(`${OLD_EMPTY}3`);

    for (const options of [withBase, withFirstExtension, withBothExtensions]) {
      expect(options.map((option) => option.value)).not.toContain(choiceEmptyValue(options));
    }
  });

  it("reads only the option's value, because that is all the core reads", () => {
    // `FieldOption.label` is presentation (`types.ts:185`), so a field whose
    // *Label* spells the sentinel out is not a collision. Reading the label
    // Would invent a constraint the core does not state.
    const labelled: readonly FieldOption[] = [{ label: OLD_EMPTY, value: "red" }];
    expect(choiceEmptyValue(labelled)).toBe(OLD_EMPTY);
  });
});

describe("the one value a single-select widget shows", () => {
  it("is a real option's value when the answer names one, in either shape", () => {
    // Both shapes, because both are what the contract admits as an inbound
    // Answer. The narrow that gets a scalar here is a `typeof` branch, not a
    // Cast — see `src/contracts.ts`, where the type-level half of the same
    // Narrowing is proved on every build.
    expect(choiceControlValue("red", COLOR_OPTIONS)).toBe("red");
    expect(choiceControlValue(["red"], COLOR_OPTIONS)).toBe("red");
    expect(choiceControlValue("blue", COLOR_OPTIONS)).toBe("blue");
    expect(choiceControlValue(["blue"], COLOR_OPTIONS)).toBe("blue");
  });

  it("is the first entry the field actually offers, skipping one it does not", () => {
    // The corpus reports an answer naming a value the field does not offer as an
    // Error — `choice-invalid-value` produces `Field 'patient.color' contains an
    // Invalid choice value.` — so a widget must not be handed a value to select.
    // It skips to the next real entry rather than emptying the control, and it
    // Does not rewrite the answer: the unknown entry is still there for the core
    // To reject.
    const answer = ["green", "blue"] as const;
    expect(choiceControlValue(answer, COLOR_OPTIONS)).toBe("blue");
    expect(answer).toEqual(["green", "blue"]);
  });

  it("is the empty value when the answer offers nothing to select", () => {
    // An absent answer, an empty list, and an answer of nothing but values the
    // Field does not offer are the same situation for a one-value widget: there
    // Is nothing drawn. All three shapes have to reach here, because all three
    // Are what a `choice` can be bound with. The answer is untouched in every
    // Case.
    const unknownOnly: readonly string[] = ["green"],
      absent: null = null;
    for (const answer of [absent, [], unknownOnly]) {
      expect(choiceControlValue(answer, COLOR_OPTIONS)).toBe(choiceEmptyValue(COLOR_OPTIONS));
    }
    expect(unknownOnly).toEqual(["green"]);
  });

  it("is the empty value of *these* options, not a module-level constant", () => {
    // The two halves have to agree on which string means empty, and they can
    // Only agree if the string is derived from the same options. A module-level
    // Constant is what let the old example collide with a document's own option.
    const withCollision: readonly FieldOption[] = [{ value: OLD_EMPTY }];
    expect(choiceControlValue([], withCollision)).toBe(`${OLD_EMPTY}1`);
    expect(choiceControlValue(["red"], COLOR_OPTIONS)).toBe("red");
  });
});

describe("the answer a control reports, in the shape the field calls for", () => {
  it("is a scalar for a single-select, and a list for a multiple — same selection", () => {
    // The same widget state, the same options, the same picked value, and the
    // Two configurations produce the two shapes the core accepts. This is the
    // Pair the old file asserted as one, and the assertion was the defect: it
    // Sent `["red"]` to a single-select, which `convert_single_choice` answers
    // With *must be a choice value*.
    expect(choiceAnswerFrom("red", COLOR_OPTIONS, false)).toBe("red");
    expect(choiceAnswerFrom("red", COLOR_OPTIONS, true)).toEqual(["red"]);
  });

  it("is absent as `null` for a single-select, and as `[]` for a multiple", () => {
    // An absent value is valid for every field, so the empty selection is an
    // Answer rather than a hole — and the core has a distinct way of saying it
    // For each configuration. Returning `[]` for a single-select because that is
    // What this function used to return would put the whole defect back.
    const empty = choiceEmptyValue(COLOR_OPTIONS);
    expect(choiceAnswerFrom(empty, COLOR_OPTIONS, false)).toBeNull();
    expect(choiceAnswerFrom(empty, COLOR_OPTIONS, true)).toEqual([]);
  });

  it("is absent as `null` when the field does not declare `allowMultiple` at all", () => {
    // The optional second case of both overloads. A document that omits the
    // Property is a single-select choice as far as the core is concerned, and
    // The default has to say so rather than falling back to a list.
    expect(choiceAnswerFrom("red", COLOR_OPTIONS)).toBe("red");
    expect(choiceAnswerFrom(choiceEmptyValue(COLOR_OPTIONS), COLOR_OPTIONS)).toBeNull();
  });

  it("does not check the selection against the options, so the core can reject it", () => {
    // A control may not drop an answer the field does not offer: the core's own
    // Report of it (`contains an invalid choice value.`) would become
    // Unreachable, exactly as the client's refusal to convert
    // (`form-definition.ts:588`) is what keeps `INVALID_TYPE` reachable. The
    // Shape follows the field and the content is left alone.
    expect(choiceAnswerFrom("green", COLOR_OPTIONS, false)).toBe("green");
    expect(choiceAnswerFrom("green", COLOR_OPTIONS, true)).toEqual(["green"]);
  });

  it("round-trips every real option back to itself, in both configurations", () => {
    // The property that makes the pair usable as a pair: what a widget shows,
    // And what it reports when nothing changes, is the same value for every
    // Option the field really offers. A translation that lost or invented one
    // Would change the answer by being rendered.
    for (const option of COLOR_OPTIONS) {
      for (const allowMultiple of [false, true] as const) {
        const reported = choiceAnswerFrom(option.value, COLOR_OPTIONS, allowMultiple);
        expect(choiceControlValue(reported, COLOR_OPTIONS)).toBe(option.value);
      }
    }
  });

  it("round-trips an empty selection back to the empty value, in both configurations", () => {
    const empty = choiceEmptyValue(COLOR_OPTIONS);
    expect(choiceControlValue(choiceAnswerFrom(empty, COLOR_OPTIONS, false), COLOR_OPTIONS)).toBe(
      empty,
    );
    expect(choiceControlValue(choiceAnswerFrom(empty, COLOR_OPTIONS, true), COLOR_OPTIONS)).toBe(
      empty,
    );
  });
});

describe("the value an unanswered choice holds", () => {
  it("is `null` for a single-select and `[]` for a multiple", () => {
    // The host has to hand a control an answer even when nobody has answered
    // The field, and the two configurations disagree on what that is. `[]` for a
    // Multiple is the shape `choiceAnswerFrom` produces for an empty selection;
    // `null` for a single-select is the absent value the core accepts.
    expect(unansweredChoiceValue(false)).toBeNull();
    expect(unansweredChoiceValue(true)).toEqual([]);
  });

  it("is `null` when the field does not declare `allowMultiple`", () => {
    expect(unansweredChoiceValue()).toBeNull();
  });

  it("is a value the core accepts, in the shape it accepts it", () => {
    // The property that makes this pair usable: the unanswered value and the
    // Empty answer of a control are the same thing, so a control that starts
    // Unanswered and is then cleared does not change shape underneath the host.
    expect(unansweredChoiceValue(false)).toBe(
      choiceAnswerFrom(choiceEmptyValue(COLOR_OPTIONS), COLOR_OPTIONS, false),
    );
    expect(unansweredChoiceValue(true)).toEqual(
      choiceAnswerFrom(choiceEmptyValue(COLOR_OPTIONS), COLOR_OPTIONS, true),
    );
  });
});

describe("the answer a control drawing toggles renders", () => {
  it("carries an option exactly when the answer says it does, in either shape", () => {
    // Membership, and nothing about the options: a control holding the list as a
    // List needs no other utility in this family, and an answer naming a value
    // The field does not offer is not this function's to hide. A single-select's
    // Scalar is a one-element list, so it carries itself and nothing else —
    // Which is the branch, not a special case.
    const list: readonly string[] = ["red", "green"],
      scalar: string = "red";
    expect(choiceHas(list, "red")).toBe(true);
    expect(choiceHas(list, "green")).toBe(true);
    expect(choiceHas(list, "blue")).toBe(false);
    expect(choiceHas(list, "")).toBe(false);
    expect(choiceHas(scalar, "red")).toBe(true);
    expect(choiceHas(scalar, "green")).toBe(false);
  });

  it("carries no option for an absent answer", () => {
    expect(choiceHas(null, "red")).toBe(false);
  });

  it("is the same for a multiple-selection control, which needs no translation", () => {
    // The corpus carries both shapes, and a control that can hold many picks
    // Reports the list as the list: `choice-allow-multiple-array-answer` is the
    // Case this is preserving.
    const multiple: readonly string[] = ["a", "b"];
    expect([...multiple]).toEqual(["a", "b"]);
    expect(choiceHas(multiple, "b")).toBe(true);
  });
});

describe("the utility surface a control receives", () => {
  it("names the decisions, with the same definitions as the functions", () => {
    // The interface is what the registry will key by type, and it is here so a
    // Reader can see that its members are the functions above and not a second
    // Implementation of them.
    const choice: ChoiceUtilities = {
      answerFrom: choiceAnswerFrom,
      controlValue: choiceControlValue,
      emptyValue: choiceEmptyValue,
      has: choiceHas,
      unansweredValue: unansweredChoiceValue,
    };

    expect(choice.emptyValue(COLOR_OPTIONS)).toBe(OLD_EMPTY);
    expect(choice.controlValue("blue", COLOR_OPTIONS)).toBe("blue");
    expect(choice.answerFrom("blue", COLOR_OPTIONS, false)).toBe("blue");
    expect(choice.answerFrom("blue", COLOR_OPTIONS, true)).toEqual(["blue"]);
    expect(choice.has("blue", "blue")).toBe(true);
    expect(choice.unansweredValue(false)).toBeNull();
    expect(choice.unansweredValue(true)).toEqual([]);
  });

  it("is called with the options and the flag a control is handed, with no re-declaration", () => {
    // The call shape a real control uses. The single-select arm narrows on
    // `allowMultiple`, so both the flag and the options come from the props the
    // Core published rather than from anything re-derived here.
    if (CHOICE_PROPS.allowMultiple) {
      expect(CHOICE_PROPS.allowMultiple).toBe(false);
    }
    const shown: string = choiceControlValue(CHOICE_PROPS.value, CHOICE_PROPS.options),
      reported: string = choiceAnswerFrom(shown, CHOICE_PROPS.options, false);

    expect(reported).toBeNull();
    expect(choiceHas(reported, "red")).toBe(false);
  });
});
