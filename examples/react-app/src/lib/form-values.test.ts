import { FormApi } from "@tanstack/react-form";
import { describe, expect, it, vi } from "vitest";

import type { FormValues } from "../components/form-runner";
import { runEvaluationThenValidation } from "./form-submission";

const TestFormApi = FormApi<
  FormValues,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined
>;

describe("TanStack Form answer boundary", () => {
  it("keeps dotted field codes as literal keys inside answers", () => {
    const initialValues: FormValues = {
      answers: {
        "body.weight.kg": "70",
      },
    };
    const form = new TestFormApi({ defaultValues: initialValues });
    const current = form.getFieldValue("answers");
    const next = {
      ...current,
      "body.height.m": "1.75",
    };

    form.setFieldValue("answers", next, { dontValidate: true });

    expect(form.state.values.answers).toEqual({
      "body.weight.kg": "70",
      "body.height.m": "1.75",
    });
    expect(Object.keys(form.getFieldValue("answers"))).toEqual(["body.weight.kg", "body.height.m"]);
  });

  it("keeps repeater edits as arrays of row objects", () => {
    const form = new TestFormApi({
      defaultValues: {
        answers: {
          "c.rows": [],
        },
      },
    });

    form.setFieldValue(
      "answers",
      {
        "c.rows": [{ "c.rows.name": "Ada" }],
      },
      { dontValidate: true },
    );

    expect(form.getFieldValue("answers")["c.rows"]).toEqual([{ "c.rows.name": "Ada" }]);
  });

  it("passes the current answers object to the submit handler", async () => {
    const onSubmit = vi.fn();
    const form = new TestFormApi({
      defaultValues: { answers: { "body.weight.kg": "70" } },
      onSubmit,
    });
    form.setFieldValue(
      "answers",
      { "body.weight.kg": "71", "body.height.m": "1.75" },
      { dontValidate: true },
    );

    await form.handleSubmit();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0].value.answers).toEqual({
      "body.weight.kg": "71",
      "body.height.m": "1.75",
    });
  });

  it("evaluates before validation and still validates when evaluation fails", async () => {
    const submittedAnswers = { "body.weight.kg": "71" };
    const evaluatedAnswers = { ...submittedAnswers, "body.bmi": "22.9" };
    const events: string[] = [];
    const validate = vi.fn(async (answers: Record<string, unknown>) => {
      events.push(`validate:${String(answers["body.bmi"])}`);
    });

    await runEvaluationThenValidation(
      async () => {
        events.push("evaluate");
        return evaluatedAnswers;
      },
      validate,
      () => submittedAnswers,
    );

    expect(events).toEqual(["evaluate", "validate:22.9"]);

    const fallbackEvents: string[] = [];
    await runEvaluationThenValidation(
      async () => {
        fallbackEvents.push("evaluate");
        return null;
      },
      async (answers) => {
        fallbackEvents.push(`validate:${String(answers["body.weight.kg"])}`);
      },
      () => submittedAnswers,
    );

    expect(fallbackEvents).toEqual(["evaluate", "validate:71"]);
    expect(validate).toHaveBeenCalledTimes(1);
  });
});
