import { describe, expect, it } from "vitest";

import {
  applyEvaluation,
  createFormDefinitionFromDescribed,
  createRuleState,
} from "../src/index.js";
import type {
  FormDefinition,
  FormSchema,
  RulesSchema,
  RuleEvaluation,
  UiSchema,
} from "../src/index.js";
import { describeForm } from "./described.js";

/**
 * The client reads identity and pointers from the core's description, so a test
 * hands it one. `describeForm` is the test-only stand-in for the core.
 */
const define = (input: {
  form: FormSchema;
  ui?: UiSchema | null;
  rules?: RulesSchema | null;
}): FormDefinition =>
  createFormDefinitionFromDescribed({
    described: describeForm(input.form),
    form: input.form,
    rules: input.rules ?? null,
    ui: input.ui ?? null,
  });

function emptyEvaluation(): RuleEvaluation {
  return {
    calculatedValues: {},
    enabled: {},
    required: {},
    validationErrors: [],
    visibility: {},
  };
}

const bmiDefinition = define({
  form: {
    fields: [
      { code: "body.weight.kg", id: "weight-kg", type: "number" },
      { code: "body.height.m", id: "height-m", type: "number" },
      { code: "body.bmi", id: "bmi", readOnly: true, type: "number" },
    ],
    schemaVersion: "1.0.0",
  },
  rules: {
    fields: {
      bmi: {
        calculate: {
          args: [
            { ref: "body.weight.kg" },
            {
              args: [{ ref: "body.height.m" }, { ref: "body.height.m" }],
              op: "mul",
            },
          ],
          op: "div",
        },
      },
    },
  },
});

describe("applyEvaluation — pure answer and rule state", () => {
  it("merges calculated values by code without mutating the input answers", () => {
    const input = { "body.height.m": "1.75", "body.weight.kg": "70" },
      calculatedValues: Record<string, unknown> = {},
      evaluation: RuleEvaluation = {
        ...emptyEvaluation(),
        calculatedValues,
      };
    calculatedValues["body.bmi"] = 22.86;

    const state = applyEvaluation(input, evaluation, bmiDefinition);

    expect(state.values["body.bmi"]).toBe(22.86);
    expect(input).toEqual({ "body.height.m": "1.75", "body.weight.kg": "70" });
    expect(state.readOnly.bmi).toBe(true);
  });

  it("keeps hidden answers while applying id-keyed boolean maps", () => {
    const visibility: Record<string, boolean> = {},
      enabled: Record<string, boolean> = {},
      required: Record<string, boolean> = {},
      evaluation: RuleEvaluation = {
        ...emptyEvaluation(),
        enabled,
        required,
        visibility,
      };
    visibility["weight-kg"] = false;
    enabled["weight-kg"] = false;
    required["weight-kg"] = true;

    const state = applyEvaluation(
      { "body.weight.kg": "70", privateNote: "retained" },
      evaluation,
      bmiDefinition,
    );

    expect(state.values).toEqual({
      "body.weight.kg": "70",
      privateNote: "retained",
    });
    expect(state.visibility["weight-kg"]).toBe(false);
    expect(state.enabled["weight-kg"]).toBe(false);
    expect(state.readOnly["weight-kg"]).toBe(true);
    expect(state.required["weight-kg"]).toBe(true);
  });

  it("keeps calculated and static read-only fields read-only when enabled is true", () => {
    const enabled: Record<string, boolean> = {},
      evaluation: RuleEvaluation = {
        ...emptyEvaluation(),
        enabled,
      };
    enabled.bmi = true;
    enabled["weight-kg"] = true;

    const state = applyEvaluation({}, evaluation, bmiDefinition);

    expect(state.enabled.bmi).toBe(true);
    expect(state.readOnly.bmi).toBe(true);
    expect(state.readOnly["weight-kg"]).toBe(false);
  });

  it("inherits group visibility and enablement through flat children", () => {
    const definition = define({
        form: {
          fields: [
            {
              code: "c.group",
              id: "group",
              items: [
                { code: "c.first", id: "first", type: "text" },
                {
                  code: "c.nested",
                  id: "nested",
                  items: [{ code: "c.second", id: "second", type: "text" }],
                  type: "group",
                },
              ],
              type: "group",
            },
          ],
        },
      }),
      visibility: Record<string, boolean> = {},
      enabled: Record<string, boolean> = {},
      evaluation: RuleEvaluation = {
        ...emptyEvaluation(),
        enabled,
        visibility,
      };
    visibility.group = false;
    enabled.group = false;

    const state = applyEvaluation({ "c.first": "one", "c.second": "two" }, evaluation, definition);

    expect(state.values).toEqual({ "c.first": "one", "c.second": "two" });
    expect(state.visibility.first).toBe(false);
    expect(state.visibility.second).toBe(false);
    expect(state.enabled.first).toBe(false);
    expect(state.readOnly.second).toBe(true);
  });

  it("applies repeater state to the repeater and its row children", () => {
    const definition = define({
        form: {
          fields: [
            {
              code: "c.rows",
              id: "rows",
              items: [{ code: "c.rows.name", id: "row-name", type: "text" }],
              readOnly: true,
              type: "repeater",
            },
          ],
        },
      }),
      enabled: Record<string, boolean> = {},
      evaluation: RuleEvaluation = {
        ...emptyEvaluation(),
        enabled,
      };
    enabled["row-name"] = true;
    const rows = [{ "c.rows.name": "Ada" }],
      state = applyEvaluation({ "c.rows": rows }, evaluation, definition);

    expect(state.values["c.rows"]).toEqual(rows);
    expect(state.readOnly.rows).toBe(true);
    expect(state.readOnly["row-name"]).toBe(true);
  });

  it("uses static metadata before the first evaluation", () => {
    const definition = define({
        form: {
          fields: [
            { code: "c.locked", id: "locked", readOnly: true, type: "text" },
            { code: "c.needed", id: "needed", required: true, type: "text" },
          ],
        },
      }),
      state = createRuleState({ kept: true }, definition);

    expect(state.values.kept).toBe(true);
    expect(state.readOnly.locked).toBe(true);
    expect(state.required.needed).toBe(true);
  });
});
