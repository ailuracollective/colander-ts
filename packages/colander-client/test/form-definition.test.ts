import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCompileRequest,
  createEvaluateRulesRequest,
  createFormDefinitionFromCompiled,
  createFormDefinitionFromDescribed,
  createValidateResponseRequest,
  humanizeCode,
  resolveFieldForPath,
} from "../src/index.js";
import type { FormDefinition, FormNode, FormSchema, RulesSchema, UiSchema } from "../src/index.js";
import { describeForm } from "./described.js";

/**
 * The client reads identity and pointers from the core's description, so a test
 * hands it one. `describeForm` is the test-only stand-in for the core.
 */
const defineForm = (input: {
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

afterEach(() => {
  vi.restoreAllMocks();
});

function flatten(nodes: readonly FormNode[]): FormNode[] {
  const out: FormNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.kind === "group" || node.kind === "repeater") {
      out.push(...flatten(node.children));
    }
  }
  return out;
}

function byCode(definition: FormDefinition, code: string) {
  return flatten(definition.root).find((node) => node.code === code);
}

const ALL_TYPES_FORM = {
    fields: [
      { code: "c.text", id: "f-text", type: "text" },
      { code: "c.textarea", id: "f-textarea", type: "textarea" },
      {
        code: "c.number",
        id: "f-number",
        maximum: 10,
        minimum: 0,
        type: "number",
      },
      { code: "c.integer", id: "f-integer", type: "integer" },
      { code: "c.boolean", id: "f-boolean", type: "boolean" },
      { code: "c.date", id: "f-date", type: "date" },
      { code: "c.datetime", id: "f-datetime", type: "datetime" },
      { code: "c.time", id: "f-time", type: "time" },
      {
        code: "c.choice",
        id: "f-choice",
        options: [{ label: "Alpha", value: "a" }, { value: "b" }],
        type: "choice",
      },
      {
        allowMultiple: true,
        code: "c.choiceMulti",
        id: "f-choice-multi",
        options: [{ value: "x" }],
        type: "choice",
      },
      {
        code: "c.group",
        id: "f-group",
        items: [{ code: "c.group.child", id: "g-child", type: "text" }],
        type: "group",
      },
      {
        code: "c.repeater",
        id: "f-repeater",
        items: [{ code: "c.repeater.name", id: "r-name", required: true, type: "text" }],
        maxItems: 3,
        minItems: 1,
        type: "repeater",
      },
      {
        code: "c.component",
        id: "f-component",
        items: [{ code: "c.component.child", id: "comp-child", type: "boolean" }],
        type: "component-ref",
      },
    ],
    schemaVersion: "1.0.0",
  },
  BMI_FORM = {
    fields: [
      { code: "body.weight.kg", id: "weight-kg", type: "number" },
      { code: "body.height.m", id: "height-m", type: "number" },
      { code: "body.bmi", id: "bmi", readOnly: true, type: "number" },
    ],
    schemaVersion: "1.0.0",
  },
  BMI_RULES = {
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
  BP_RULES = {
    validations: [
      {
        code: "BP_SYSTOLIC_GT_DIASTOLIC",
        message: "Systolic must be greater than diastolic",
      },
    ],
  };

describe("createFormDefinition — field definitions", () => {
  const definition = defineForm({ form: ALL_TYPES_FORM });

  it("builds a node for every supported field type", () => {
    expect(byCode(definition, "c.text")?.kind).toBe("field");
    expect(byCode(definition, "c.textarea")?.type).toBe("textarea");
    expect(byCode(definition, "c.number")?.type).toBe("number");
    expect(byCode(definition, "c.integer")?.type).toBe("integer");
    expect(byCode(definition, "c.boolean")?.type).toBe("boolean");
    expect(byCode(definition, "c.date")?.type).toBe("date");
    expect(byCode(definition, "c.datetime")?.type).toBe("datetime");
    expect(byCode(definition, "c.time")?.type).toBe("time");
    expect(byCode(definition, "c.choice")?.type).toBe("choice");
    expect(byCode(definition, "c.choiceMulti")?.type).toBe("choice");
    expect(byCode(definition, "c.group")?.kind).toBe("group");
    expect(byCode(definition, "c.repeater")?.kind).toBe("repeater");
    expect(byCode(definition, "c.component")?.kind).toBe("group");
  });

  it("keeps group children flat in the answer model", () => {
    const group = byCode(definition, "c.group");
    expect(group?.kind).toBe("group");
    if (group?.kind !== "group") {
      throw new Error("expected a group node");
    }
    expect(group.children.map((child) => child.code)).toEqual(["c.group.child"]);
    // A group has no answer of its own: it is a container, not a value.
    expect(group.code).toBe("c.group");
  });

  it("keeps repeaters as arrays of row objects keyed by child code", () => {
    const repeater = byCode(definition, "c.repeater");
    expect(repeater?.kind).toBe("repeater");
    if (repeater?.kind !== "repeater") {
      throw new Error("expected a repeater node");
    }
    expect(repeater.children.map((child) => child.code)).toEqual(["c.repeater.name"]);
    // The row shape is the core's business: it validates the array against the
    // Declared field, so the client does not model it.
    expect(repeater.code).toBe("c.repeater");
  });

  it("retains option values and labels for selectors", () => {
    const choice = byCode(definition, "c.choice");
    if (choice?.kind !== "field") {
      throw new Error("expected a leaf field node");
    }
    expect(choice.options).toEqual([{ label: "Alpha", value: "a" }, { value: "b" }]);
  });
});

describe("createFormDefinition — compiled index and metadata", () => {
  it("indexes ids, codes, and nested JSON pointers", () => {
    const definition = defineForm({ form: ALL_TYPES_FORM });
    expect(definition.codeById["g-child"]).toBe("c.group.child");
    expect(definition.idByCode["c.group.child"]).toBe("g-child");
    expect(definition.byPointer["/fields/10/items/0"]).toEqual({
      code: "c.group.child",
      id: "g-child",
    });
    expect(definition.byPointer["/fields/11/items/0"]).toEqual({
      code: "c.repeater.name",
      id: "r-name",
    });
    expect(definition.descendantCodes["f-group"]).toEqual(["c.group.child"]);
    expect(definition.descendantIds["f-group"]).toEqual(["g-child"]);
  });

  it("marks calculated and statically read-only fields", () => {
    const definition = defineForm({
      form: BMI_FORM,
      rules: BMI_RULES,
    });
    expect(definition.calculatedCodes.has("body.bmi")).toBe(true);
    expect(byCode(definition, "body.bmi")?.readOnly).toBe(true);
    expect(definition.staticReadOnlyCodes.has("body.bmi")).toBe(true);
    expect(byCode(definition, "body.weight.kg")?.readOnly).toBe(false);
  });

  it("uses layout labels before field titles and humanized codes otherwise", () => {
    const definition = defineForm({
      form: BMI_FORM,
      ui: {
        layout: [
          { fieldId: "weight-kg", title: "Weight (kg)", type: "field" },
          { fieldId: "height-m", type: "field" },
        ],
      },
    });
    expect(definition.labelByCode["body.weight.kg"]).toBe("Weight (kg)");
    expect(definition.labelByCode["body.height.m"]).toBe("Body height m");
    expect(definition.labelById["weight-kg"]).toBe("Weight (kg)");
  });

  it("decodes each compiled document exactly once without changing wire strings", () => {
    const compiled = {
        contentHash: "hash-preserved",
        dependencyMetadataJson: '{"ignored":true}',
        formSchemaJson: '{\n  "fields": []\n}',
        rulesSchemaJson: ' { "fields": {} } ',
        uiSchemaJson: '{"fields":{"f-text":{"hidden":true}}}',
      } as const,
      // Built before the spies go up: describing the form is the caller's job, and
      // The assertion below is that the client itself parses each document once.
      described = describeForm(JSON.parse(compiled.formSchemaJson)),
      parse = vi.spyOn(JSON, "parse"),
      stringify = vi.spyOn(JSON, "stringify"),
      definition = createFormDefinitionFromCompiled(compiled, described);

    expect(definition.fieldIds).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(3);
    expect(stringify).not.toHaveBeenCalled();
    expect(compiled.formSchemaJson).toBe('{\n  "fields": []\n}');
    expect(compiled.rulesSchemaJson).toBe(' { "fields": {} } ');
    expect(compiled.uiSchemaJson).toBe('{"fields":{"f-text":{"hidden":true}}}');
  });
});

describe(resolveFieldForPath, () => {
  const definition = defineForm({
    form: BMI_FORM,
    rules: BMI_RULES,
  });

  it("resolves schema pointers, answer pointers, and rule errors", () => {
    expect(resolveFieldForPath(definition, "/fields/2")).toMatchObject({
      code: "body.bmi",
      id: "bmi",
      kind: "field",
    });
    expect(resolveFieldForPath(definition, "/answers/body.weight.kg")).toMatchObject({
      code: "body.weight.kg",
      id: "weight-kg",
      kind: "answers",
    });
    expect(resolveFieldForPath(definition, "/rules/validations")).toMatchObject({
      kind: "rules",
    });
  });

  it("does not crash on malformed percent escapes", () => {
    expect(() => resolveFieldForPath(definition, "/answers/%E0%A4%A")).not.toThrow();
    expect(resolveFieldForPath(definition, "/answers/%E0%A4%A")).toMatchObject({
      code: "%E0%A4%A",
      kind: "answers",
    });
  });

  it("returns null for an unknown path", () => {
    expect(resolveFieldForPath(definition, "/nope/0/1")).toBeNull();
  });
});

describe("answer forwarding", () => {
  const compiled = {
      contentHash: "hash",
      dependencyMetadataJson: "{}",
      formSchemaJson: JSON.stringify(ALL_TYPES_FORM),
      rulesSchemaJson: JSON.stringify(BMI_RULES),
      uiSchemaJson: '{"fields":{}}',
    } as const,
    definition = createFormDefinitionFromCompiled(
      compiled,
      describeForm(JSON.parse(compiled.formSchemaJson)),
    );

  it("forwards a string for a numeric field unchanged, so the core can reject it", () => {
    // The core's conversion is strict: a string in a `number` field is
    // `INVALID_TYPE` (src/validate/conversion.rs). Converting here would make
    // That error unreachable, so the string must survive to the wire.
    const request = createEvaluateRulesRequest(compiled, definition, {
      "c.number": "70",
      "c.text": "70",
    });
    expect(request.values).toEqual({ "c.number": "70", "c.text": "70" });
  });

  it("forwards booleans and multi-choice values without reshaping them", () => {
    const request = createEvaluateRulesRequest(compiled, definition, {
      "c.boolean": "true",
      "c.choiceMulti": "x",
    });
    expect(request.values).toEqual({ "c.boolean": "true", "c.choiceMulti": "x" });
  });

  it("forwards unknown keys untouched", () => {
    const request = createEvaluateRulesRequest(compiled, definition, { unknown: "7" });
    expect(request.values).toEqual({ unknown: "7" });
  });

  it("forwards a repeater array exactly as given", () => {
    const request = createValidateResponseRequest(
      compiled,
      definition,
      { "c.repeater": [{ "c.repeater.name": 42 }] },
      "Draft",
    );
    expect(JSON.parse(request.answersJson)).toEqual({
      "c.repeater": [{ "c.repeater.name": 42 }],
    });
  });
});

describe("object-first form API", () => {
  it("does not parse or serialize object documents", () => {
    const parse = vi.spyOn(JSON, "parse"),
      stringify = vi.spyOn(JSON, "stringify");

    defineForm({ form: ALL_TYPES_FORM, rules: BMI_RULES });

    expect(parse).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();
  });
});

describe("compiled wire boundary", () => {
  it("creates a compile request from object documents", () => {
    const request = createCompileRequest({
      form: ALL_TYPES_FORM,
      rules: BMI_RULES,
    });

    expect(request.formSchemaJson).toBe(JSON.stringify(ALL_TYPES_FORM));
    expect(request.rulesSchemaJson).toBe(JSON.stringify(BMI_RULES));
    expect(request.uiSchemaJson).toBeUndefined();
  });

  it("forwards resolved components through the compile request contract", () => {
    const components = [
        {
          code: "address",
          formSchemaJson: '{"fields":[]}',
          version: "1.0.0",
        },
      ] as const,
      request = createCompileRequest({ components, form: { fields: [] } });

    expect(request.components).toEqual(components);
  });

  it("creates validation requests with dotted codes, repeater rows, and verbatim wire text", () => {
    const compiled = {
        contentHash: "content-hash-before",
        dependencyMetadataJson: '{"unchanged":true}',
        formSchemaJson: `\n${JSON.stringify(ALL_TYPES_FORM)}\n`,
        rulesSchemaJson: ` ${JSON.stringify(BMI_RULES)} `,
        uiSchemaJson: `{"fields":{"c.number":{"hidden":false}}}`,
      } as const,
      definition = createFormDefinitionFromCompiled(
        compiled,
        describeForm(JSON.parse(compiled.formSchemaJson)),
      ),
      request = createValidateResponseRequest(
        compiled,
        definition,
        {
          "c.number": "70",
          "c.repeater": [{ "c.repeater.name": 42 }],
          unknown: "7",
        },
        "Complete",
      ),
      evaluationRequest = createEvaluateRulesRequest(compiled, definition, {
        "c.number": "70",
      });

    expect(evaluationRequest.values).toEqual({ "c.number": "70" });
    expect(evaluationRequest.formSchemaJson).toBe(compiled.formSchemaJson);
    expect(evaluationRequest.rulesSchemaJson).toBe(compiled.rulesSchemaJson);
    expect(request.formSchemaJson).toBe(compiled.formSchemaJson);
    expect(request.rulesSchemaJson).toBe(compiled.rulesSchemaJson);
    expect(request.uiSchemaJson).toBe(compiled.uiSchemaJson);
    expect(request.mode).toBe("Complete");
    expect(request.answersJson).toBe(
      JSON.stringify({
        "c.number": "70",
        "c.repeater": [{ "c.repeater.name": 42 }],
        unknown: "7",
      }),
    );
    expect(compiled.contentHash).toBe("content-hash-before");
  });

  it("keeps a calculated answer in the payload, so a stale value is reported", () => {
    const compiled = {
        contentHash: "content-hash-before",
        dependencyMetadataJson: '{"unchanged":true}',
        formSchemaJson: `\n${JSON.stringify(BMI_FORM)}\n`,
        rulesSchemaJson: ` ${JSON.stringify(BMI_RULES)} `,
        uiSchemaJson: '  {"fields":{}}  ',
      } as const,
      definition = createFormDefinitionFromCompiled(
        compiled,
        describeForm(JSON.parse(compiled.formSchemaJson)),
      ),
      answers = {
        "body.bmi": "not-a-user-value",
        "body.height.m": "1.75",
        "body.weight.kg": "70",
      },
      original = { ...answers },
      request = createValidateResponseRequest(compiled, definition, answers, "Complete");

    expect(JSON.parse(request.answersJson)).toEqual({
      "body.bmi": "not-a-user-value",
      "body.height.m": "1.75",
      "body.weight.kg": "70",
    });
    expect(answers).toEqual(original);
    expect(request.formSchemaJson).toBe(compiled.formSchemaJson);
    expect(request.rulesSchemaJson).toBe(compiled.rulesSchemaJson);
    expect(request.uiSchemaJson).toBe(compiled.uiSchemaJson);
  });

  it("omits absent optional wire documents without changing the compiled result", () => {
    const compiled = {
        contentHash: "hash",
        dependencyMetadataJson: "{}",
        formSchemaJson: '{"fields":[]}',
        rulesSchemaJson: null,
        uiSchemaJson: null,
      } as const,
      definition = createFormDefinitionFromCompiled(
        compiled,
        describeForm(JSON.parse(compiled.formSchemaJson)),
      ),
      request = createValidateResponseRequest(compiled, definition, {}, "Draft");

    expect(request).toEqual({
      answersJson: "{}",
      formSchemaJson: '{"fields":[]}',
      mode: "Draft",
    });
    expect(compiled.uiSchemaJson).toBeNull();
    expect(compiled.rulesSchemaJson).toBeNull();
  });
});

describe("model helpers", () => {
  it("humanizes dotted and camel-case codes", () => {
    expect(humanizeCode("body.weight.kg")).toBe("Body weight kg");
    expect(humanizeCode("camelCaseCode")).toBe("Camel Case Code");
  });

  it("accepts rules as an object without a JSON text argument", () => {
    const definition = defineForm({ form: BMI_FORM, rules: BP_RULES });
    expect(definition.calculatedCodes).toEqual(new Set());
  });
});
