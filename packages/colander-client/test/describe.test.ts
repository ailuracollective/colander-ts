import { describe, expect, it } from "vitest";

import { createRuleState } from "../src/apply-rules.js";
import type { RuleState } from "../src/apply-rules.js";
import {
  ANSWERS_ERROR_KEY,
  RULES_ERROR_KEY,
  UNRESOLVED_ERROR_KEY,
  describeField,
  groupErrorsByField,
} from "../src/describe.js";
import type {
  ControlConstraints,
  ControlDescriptor,
  ControlOption,
  ControlState,
  FieldError,
} from "../src/describe.js";
import { createFormDefinitionFromDescribed } from "../src/form-definition.js";
import type {
  FormDefinition,
  FormNode,
  FormSchema,
  LeafNode,
  RulesSchema,
  UiSchema,
} from "../src/form-definition.js";
import type { ResponseError } from "../src/types.js";
import { describeForm } from "./described.js";

/**
 * Runtime descriptor tests.
 *
 * The client has no core dependency, so these tests stand the compiled form up
 * from the test-only `describeForm` fixture rather than asking the core for it,
 * exactly as `form-definition.test.ts` and `apply-rules.test.ts` do. A hand
 * written node would test a shape the package does not build, so the fixture
 * builds every node here.
 */
const defineForm = (input: {
  form: FormSchema;
  rules?: RulesSchema | null;
  ui?: UiSchema | null;
}): FormDefinition =>
  createFormDefinitionFromDescribed({
    described: describeForm(input.form),
    form: input.form,
    rules: input.rules ?? null,
    ui: input.ui ?? null,
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

/** The leaf node the definition really built for `code`. */
function leaf(definition: FormDefinition, code: string): LeafNode {
  const node = flatten(definition.root).find((candidate) => candidate.code === code);
  if (node?.kind !== "field") {
    throw new Error(`no leaf node for ${code}`);
  }
  return node;
}

const error = (path: string, code = "INVALID_VALUE"): ResponseError => ({
    code,
    message: `invalid at ${path}`,
    path,
  }),
  /**
   * A form with one nested field, so the grouping cases exercise the pointer
   * shapes the core actually emits rather than only top-level ones.
   */
  GROUPING_FORM: FormSchema = {
    fields: [
      { code: "body.weight.kg", id: "weight-kg", type: "number" },
      {
        code: "contact",
        id: "contact",
        items: [{ code: "contact.email", id: "email", type: "text" }],
        type: "group",
      },
      { code: "note", id: "note", type: "text" },
    ],
  };

describe("reserved error keys", () => {
  it("names the three buckets a renderer cannot miss", () => {
    expect(ANSWERS_ERROR_KEY).toBe("__answers__");
    expect(RULES_ERROR_KEY).toBe("__rules__");
    expect(UNRESOLVED_ERROR_KEY).toBe("__unresolved__");
  });

  it("keeps the three keys distinct, so one bucket cannot shadow another", () => {
    expect(new Set([ANSWERS_ERROR_KEY, RULES_ERROR_KEY, UNRESOLVED_ERROR_KEY]).size).toBe(3);
  });

  it("publishes the descriptor types as a usable surface", () => {
    // The types exist so a renderer can annotate what it receives. This case
    // Exists so a change that drops one of them fails `typecheck`, not a
    // Consumer's build.
    const fieldError: FieldError = { code: "REQUIRED", message: "required", path: "/fields/0" },
      option: ControlOption = { label: "Alpha", selected: false, value: "a" },
      constraints: ControlConstraints = { minimum: 0 },
      state: ControlState = { enabled: true, readOnly: false, required: false, visible: true },
      descriptor: ControlDescriptor = {
        aria: { invalid: true },
        code: "c.text",
        constraints,
        description: "desc",
        errors: [fieldError],
        id: "f-text",
        label: "Text",
        options: [option],
        pointer: "/fields/0",
        state,
        type: "text",
        value: "hello",
      };

    expect(descriptor.options).toEqual([option]);
    expect(descriptor.aria.invalid).toBe(true);
    expect(groupErrorsByField).toBeTypeOf("function");
    expect(describeField).toBeTypeOf("function");
  });
});
describe(groupErrorsByField, () => {
  const definition = defineForm({ form: GROUPING_FORM });

  it("keys a schema-pointer error by its field id", () => {
    const grouped = groupErrorsByField(definition, [error("/fields/0", "OUT_OF_RANGE")]);

    expect(grouped["weight-kg"]).toEqual([
      { code: "OUT_OF_RANGE", message: "invalid at /fields/0", path: "/fields/0" },
    ]);
  });

  it("keys a nested field's pointer by that field's id", () => {
    const grouped = groupErrorsByField(definition, [error("/fields/1/items/0", "REQUIRED")]);

    expect(Object.keys(grouped)).toEqual(["email"]);
  });

  it("keys an answers error whose code names a field by that field's id", () => {
    // The reserved answers bucket is for keys the form does not declare. When the
    // Key does name a field, the field is what failed, so it is keyed as one.
    const grouped = groupErrorsByField(definition, [error("/answers/body.weight.kg")]);

    expect(grouped["weight-kg"]).toHaveLength(1);
    expect(grouped[ANSWERS_ERROR_KEY]).toBeUndefined();
  });

  it("keeps an unknown answer key under the answers bucket", () => {
    const unknown = error("/answers/not.a.field", "UNKNOWN_FIELD");

    expect(groupErrorsByField(definition, [unknown])).toEqual({
      [ANSWERS_ERROR_KEY]: [unknown],
    });
  });

  it("keeps a cross-field validation failure under the rules bucket", () => {
    const crossField = error("/rules/validations", "BP_SYSTOLIC_GT_DIASTOLIC");

    expect(groupErrorsByField(definition, [crossField])).toEqual({
      [RULES_ERROR_KEY]: [crossField],
    });
  });

  it("keeps a path that resolves to nothing under the unresolved bucket", () => {
    const unknown = error("/nope/0/1", "UNKNOWN_PATH");

    expect(groupErrorsByField(definition, [unknown])).toEqual({
      [UNRESOLVED_ERROR_KEY]: [unknown],
    });
  });

  it("drops no error and preserves the order within a field", () => {
    const first = error("/fields/2", "REQUIRED"),
      second = error("/fields/2", "TOO_LONG"),
      crossField = error("/rules/validations", "BP_SYSTOLIC_GT_DIASTOLIC"),
      all = [first, crossField, second],
      grouped = groupErrorsByField(definition, all),
      every = Object.values(grouped).flat();

    // Order across buckets is the order the buckets were first written, which is
    // Not a promise this function makes; the total is.
    expect(every).toHaveLength(all.length);
    expect([...every].sort((a, b) => a.path.localeCompare(b.path))).toEqual(
      [...all].sort((a, b) => a.path.localeCompare(b.path)),
    );
    expect(grouped.note).toEqual([first, second]);
    expect(grouped[RULES_ERROR_KEY]).toEqual([crossField]);
  });

  it("returns an empty grouping for an empty response", () => {
    expect(groupErrorsByField(definition, [])).toEqual({});
  });
});

/**
 * One compiled form covering the identities a descriptor has to state: a plain
 * text field with a description, a schema-required field, a statically read-only
 * field, and a field the rules document calculates.
 */
const DESCRIPTOR_FORM: FormSchema = {
    fields: [
      { code: "note", description: "Anything we should know", id: "note", type: "text" },
      { code: "needed", id: "needed", required: true, type: "text" },
      { code: "locked", id: "locked", readOnly: true, type: "text" },
      { code: "body.bmi", id: "bmi", type: "number" },
    ],
  },
  DESCRIPTOR_RULES: RulesSchema = {
    fields: {
      bmi: {
        calculate: {
          args: [
            { ref: "body.weight.kg" },
            { args: [{ ref: "body.height.m" }, { ref: "body.height.m" }], op: "mul" },
          ],
          op: "div",
        },
      },
    },
  },
  DESCRIPTOR_UI: UiSchema = {
    layout: [{ fieldId: "note", title: "Note from the layout", type: "field" }],
  },
  descriptorDefinition = defineForm({
    form: DESCRIPTOR_FORM,
    rules: DESCRIPTOR_RULES,
    ui: DESCRIPTOR_UI,
  }),
  /** A state in which every id is absent from every map. */
  bareState = (values: Record<string, unknown> = {}): RuleState => ({
    enabled: {},
    readOnly: {},
    required: {},
    values,
    visibility: {},
  });

describe("describeField — identity, label, value, and state", () => {
  it("describes a leaf node with no errors argument at all", () => {
    const descriptor = describeField(
      leaf(descriptorDefinition, "note"),
      bareState({ note: "hello" }),
    );

    expect(descriptor).toMatchObject({
      code: "note",
      description: "Anything we should know",
      id: "note",
      // The label is the node's, which the definition resolved from the layout
      // Title ahead of the field's own title.
      label: "Note from the layout",
      pointer: "/fields/0",
      type: "text",
      value: "hello",
    });
  });

  it("reports visible and enabled true and the node baseline for a field absent from every map", () => {
    const needed = describeField(leaf(descriptorDefinition, "needed"), bareState()),
      locked = describeField(leaf(descriptorDefinition, "locked"), bareState());

    expect(needed.state).toEqual({
      enabled: true,
      readOnly: false,
      required: true,
      visible: true,
    });
    expect(locked.state).toEqual({
      enabled: true,
      readOnly: true,
      required: false,
      visible: true,
    });
  });

  it("takes required from the evaluation rather than from the schema baseline", () => {
    const evaluated = createRuleState({ needed: "" }, descriptorDefinition),
      state: RuleState = { ...evaluated, required: { ...evaluated.required, needed: false } };

    expect(state.required.needed).toBe(false);
    expect(describeField(leaf(descriptorDefinition, "needed"), state).state.required).toBe(false);
  });

  it("reports a calculated field read-only regardless of the evaluation", () => {
    // `node.readOnly` is where the calculated signal reaches this function:
    // `createFormDefinitionFromDescribed` folds `calculatedCodes` into it. A
    // Hand-written state claiming otherwise must not be able to lower it.
    const node = leaf(descriptorDefinition, "body.bmi"),
      lying: RuleState = {
        ...bareState({ "body.bmi": 22.9 }),
        enabled: { bmi: true },
        readOnly: { bmi: false },
      };

    expect(node.readOnly).toBe(true);
    expect(describeField(node, lying).state.readOnly).toBe(true);
  });

  it("reports a hidden field invisible and keeps its value", () => {
    const evaluated = createRuleState({ locked: "kept" }, descriptorDefinition),
      state: RuleState = {
        ...evaluated,
        visibility: { ...evaluated.visibility, locked: false },
      },
      descriptor = describeField(leaf(descriptorDefinition, "locked"), state);

    expect(descriptor.state.visible).toBe(false);
    expect(descriptor.value).toBe("kept");
  });

  it("reads the field's own value by code from the rule state", () => {
    const state = createRuleState({ "body.bmi": 22.857 }, descriptorDefinition);

    expect(describeField(leaf(descriptorDefinition, "body.bmi"), state).value).toBe(22.857);
  });

  it("reports an undefined value for an answer nobody has given yet", () => {
    expect(describeField(leaf(descriptorDefinition, "note"), bareState()).value).toBeUndefined();
  });
});

const CHOICE_FORM: FormSchema = {
    fields: [
      {
        code: "color",
        id: "color",
        options: [
          { label: "Red", value: "red" },
          { value: "blue" },
          { label: "Green", value: "green" },
        ],
        type: "choice",
      },
      {
        allowMultiple: true,
        code: "tags",
        id: "tags",
        options: [
          { label: "Red", value: "red" },
          { value: "blue" },
          { label: "Green", value: "green" },
        ],
        type: "choice",
      },
      {
        // A `choice` carries only `title`, `description` and `allowMultiple`, so
        // These two belong to no vocabulary the core honours for it.
        code: "graded",
        id: "graded",
        maxLength: 3,
        minLength: 1,
        options: [{ value: "a" }],
        type: "choice",
      },
      {
        code: "headline",
        id: "headline",
        maxLength: 10,
        minLength: 2,
        pattern: "^[a-z ]+$",
        type: "text",
      },
      {
        code: "score",
        decimalPlaces: 2,
        id: "score",
        // `pattern` and `minLength` belong to other types' vocabularies; the core
        // Ignores them here, so the descriptor must not repeat them.
        maxLength: 99,
        maximum: 10,
        minLength: 5,
        minimum: 0,
        multipleOf: 0.5,
        pattern: "^[0-9]+$",
        type: "number",
      },
    ],
  },
  /**
   * A type the core vocabulary does not contain, with options and constraints on
   * it. Only a hand-authored document can reach this, which is exactly the case a
   * descriptor has to survive.
   */
  CUSTOM_FORM: FormSchema = {
    fields: [
      {
        code: "slider",
        id: "slider",
        maximum: 10,
        minimum: 0,
        options: [{ value: "low" }],
        type: "slider",
      },
    ],
  },
  choiceDefinition = defineForm({ form: CHOICE_FORM }),
  customDefinition = defineForm({ form: CUSTOM_FORM });

describe("describeField — options", () => {
  it("marks exactly the matching option selected in a single-select choice", () => {
    const descriptor = describeField(leaf(choiceDefinition, "color"), bareState({ color: "blue" }));

    expect(descriptor.options).toEqual([
      { label: "Red", selected: false, value: "red" },
      { label: "blue", selected: true, value: "blue" },
      { label: "Green", selected: false, value: "green" },
    ]);
  });

  it("marks every member of the list in an allowMultiple choice", () => {
    const descriptor = describeField(
      leaf(choiceDefinition, "tags"),
      bareState({ tags: ["red", "green"] }),
    );

    expect(descriptor.options.filter((option) => option.selected)).toEqual([
      { label: "Red", selected: true, value: "red" },
      { label: "Green", selected: true, value: "green" },
    ]);
  });

  it("selects nothing when nobody has answered yet", () => {
    const descriptor = describeField(leaf(choiceDefinition, "color"), bareState());

    expect(descriptor.options.every((option) => !option.selected)).toBe(true);
  });

  it("selects nothing for a single-select handed a list the core would reject", () => {
    // The core converts a single-select strictly: `convert_single_choice` takes
    // `Json::as_str` and a list is a type error. Reading membership out of a list
    // Here would render a selection the core does not consider valid.
    const descriptor = describeField(
      leaf(choiceDefinition, "color"),
      bareState({ color: ["red", "green"] }),
    );

    expect(descriptor.options.some((option) => option.selected)).toBe(false);
  });

  it("selects nothing for an allowMultiple choice handed a bare string", () => {
    const descriptor = describeField(leaf(choiceDefinition, "tags"), bareState({ tags: "red" }));

    expect(descriptor.options.some((option) => option.selected)).toBe(false);
  });

  it("gives every type other than choice an empty option list", () => {
    expect(describeField(leaf(choiceDefinition, "headline"), bareState()).options).toEqual([]);
    expect(describeField(leaf(descriptorDefinition, "body.bmi"), bareState()).options).toEqual([]);
  });
});

describe("describeField — constraints", () => {
  it("keeps the wire names for a text field's constraints", () => {
    const { constraints } = describeField(leaf(choiceDefinition, "headline"), bareState());

    expect(constraints).toEqual({ maxLength: 10, minLength: 2, pattern: "^[a-z ]+$" });
  });

  it("keeps minimum and maximum rather than renaming them to min and max", () => {
    const { constraints } = describeField(leaf(choiceDefinition, "score"), bareState());

    expect(constraints).toEqual({
      decimalPlaces: 2,
      maximum: 10,
      minimum: 0,
      multipleOf: 0.5,
    });
    expect(Object.keys(constraints)).not.toContain("min");
    expect(Object.keys(constraints)).not.toContain("max");
  });

  it("drops a constraint the type's own vocabulary does not carry", () => {
    const { constraints } = describeField(leaf(choiceDefinition, "score"), bareState());

    expect(constraints).not.toHaveProperty("pattern");
    expect(constraints).not.toHaveProperty("minLength");
    expect(constraints).not.toHaveProperty("maxLength");
  });

  it("drops a text constraint a choice carries, because a choice carries no such key", () => {
    expect(describeField(leaf(choiceDefinition, "graded"), bareState()).constraints).toEqual({});
  });

  it("does not report allowMultiple as a constraint", () => {
    const descriptor = describeField(leaf(choiceDefinition, "tags"), bareState({ tags: ["red"] }));

    expect(descriptor.constraints).toEqual({});
    expect(descriptor.constraints).not.toHaveProperty("allowMultiple");
  });

  it("reports empty constraints for a type outside the core vocabulary", () => {
    expect(() => describeField(leaf(customDefinition, "slider"), bareState())).not.toThrow();
    expect(describeField(leaf(customDefinition, "slider"), bareState()).constraints).toEqual({});
  });
});

describe("describeField — totality", () => {
  it("describes a type the core vocabulary does not contain", () => {
    const descriptor = describeField(leaf(customDefinition, "slider"), bareState({ slider: 7 }));

    expect(descriptor).toMatchObject({
      code: "slider",
      constraints: {},
      id: "slider",
      label: "Slider",
      options: [],
      pointer: "/fields/0",
      type: "slider",
      value: 7,
    });
  });

  it("keeps a container's children describable when the vocabulary is unknown", () => {
    // A `component-ref` is a container, so it never reaches `describeField`; a
    // Hand-authored unknown type does reach it as a leaf, and must not throw.
    expect(describeField(leaf(customDefinition, "slider"), bareState()).errors).toEqual([]);
  });
});

describe("describeField — errors and aria", () => {
  it("reports the errors it was given and marks the control invalid", () => {
    const first: FieldError = { code: "REQUIRED", message: "required", path: "/fields/2" },
      second: FieldError = { code: "TOO_LONG", message: "too long", path: "/fields/2" },
      descriptor = describeField(leaf(choiceDefinition, "headline"), bareState(), [first, second]);

    expect(descriptor.errors).toEqual([first, second]);
    expect(descriptor.aria.invalid).toBe(true);
  });

  it("reports no errors and a valid control when none were given", () => {
    const descriptor = describeField(leaf(choiceDefinition, "headline"), bareState(), []);

    expect(descriptor.errors).toEqual([]);
    expect(descriptor.aria.invalid).toBe(false);
  });

  it("points describedBy at the field id when a description exists", () => {
    const descriptor = describeField(leaf(descriptorDefinition, "note"), bareState());

    expect(descriptor.aria).toEqual({ describedBy: "note", invalid: false });
  });

  it("omits describedBy entirely when the field has no description", () => {
    const descriptor = describeField(leaf(descriptorDefinition, "needed"), bareState());

    expect(descriptor.aria).toEqual({ invalid: false });
    expect(descriptor.description).toBeUndefined();
  });

  it("groups a validated response and describes the field that failed", () => {
    const responseErrors: readonly ResponseError[] = [
        error("/fields/0", "TOO_LONG"),
        error("/rules/validations", "BP_SYSTOLIC_GT_DIASTOLIC"),
      ],
      grouped = groupErrorsByField(descriptorDefinition, responseErrors),
      descriptor = describeField(
        leaf(descriptorDefinition, "note"),
        bareState(),
        grouped.note ?? [],
      );

    expect(grouped.note).toEqual(responseErrors.slice(0, 1));
    expect(descriptor.aria.invalid).toBe(true);
  });
});
