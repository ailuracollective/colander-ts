import {
  createCompileRequest,
  type CompileRequest,
  type ComponentReference,
  type FormSchema,
  type RulesSchema,
  type UiSchema,
} from "@ailura/colander-client";

/** The execution boundary is explicit so a sample never hides an HTTP fallback. */
export type SampleExecution = "http" | "wasm";

/** Stable facts used by focused tests instead of human-readable error wording. */
export interface SampleExpectedFacts {
  calculatedValues?: Record<string, unknown>;
  visibility?: Record<string, boolean>;
  enabled?: Record<string, boolean>;
  required?: Record<string, boolean>;
  answerCodes?: string[];
  expandedComponentCodes?: string[];
  validation?: {
    isValid: boolean;
    errorCodes?: string[];
    normalizedAnswers?: Record<string, unknown>;
  };
}

export interface SampleDefinition {
  id: string;
  name: string;
  summary: string;
  /** The raw (uncompiled) form document. */
  form: FormSchema;
  /** The raw (uncompiled) rules document. */
  rules: RulesSchema;
  /** Optional raw UI document, serialized only at the request boundary. */
  ui?: UiSchema;
  /** Resolved component versions supplied by the caller, not the transport. */
  components?: readonly ComponentReference[];
  /** Which delivery source this sample is allowed to use. */
  execution: SampleExecution;
  /** Prefilled values, keyed by field **code**. */
  initialValues: Record<string, unknown>;
  /** Human-readable context shown in the UI. */
  expected: string;
  /** Stable assertions for focused tests and examples. */
  expectedFacts: SampleExpectedFacts;
}

const BMI_FORM: FormSchema = {
  schemaVersion: "1.0.0",
  fields: [
    {
      id: "weight-kg",
      code: "body.weight.kg",
      type: "number",
    },
    {
      id: "height-m",
      code: "body.height.m",
      type: "number",
    },
    {
      id: "bmi",
      code: "body.bmi",
      type: "number",
      readOnly: true,
      multipleOf: 0.01,
    },
  ],
};

const BMI_RULES: RulesSchema = {
  schemaVersion: "1.0.0",
  formSchemaVersion: "1.0.0",
  fields: {
    bmi: {
      calculate: {
        op: "div",
        args: [
          { ref: "body.weight.kg" },
          {
            op: "mul",
            args: [{ ref: "body.height.m" }, { ref: "body.height.m" }],
          },
        ],
      },
    },
  },
};

/** The two existing fixture-derived cases remain available as HTTP examples. */
export const BMI_SAMPLE: SampleDefinition = {
  id: "bmi",
  name: "BMI calculation",
  summary: "A calculated field: the engine computes BMI from weight and height.",
  expected:
    "Weight 70 kg and height 1.75 m must yield BMI 22.86, computed by the selected Colander source.",
  execution: "http",
  initialValues: {
    "body.weight.kg": 70,
    "body.height.m": 1.75,
  },
  form: BMI_FORM,
  rules: BMI_RULES,
  expectedFacts: {
    calculatedValues: { "body.bmi": 22.86 },
    enabled: { bmi: false },
  },
};

const BP_FORM: FormSchema = {
  schemaVersion: "1.0.0",
  fields: [
    {
      id: "systolic",
      code: "vital.bp.systolic",
      type: "integer",
    },
    {
      id: "diastolic",
      code: "vital.bp.diastolic",
      type: "integer",
    },
  ],
};

const BP_RULES: RulesSchema = {
  schemaVersion: "1.0.0",
  formSchemaVersion: "1.0.0",
  fields: {},
  validations: [
    {
      code: "BP_SYSTOLIC_GT_DIASTOLIC",
      message: "Systolic must be greater than diastolic",
      when: {
        op: "and",
        args: [
          {
            op: "not",
            args: [{ op: "empty", args: [{ ref: "vital.bp.systolic" }] }],
          },
          {
            op: "not",
            args: [{ op: "empty", args: [{ ref: "vital.bp.diastolic" }] }],
          },
        ],
      },
      assert: {
        op: "gt",
        args: [{ ref: "vital.bp.systolic" }, { ref: "vital.bp.diastolic" }],
      },
    },
  ],
};

export const BP_SAMPLE: SampleDefinition = {
  id: "bp",
  name: "Blood pressure",
  summary: "A cross-field rule: systolic must exceed diastolic.",
  expected:
    "With systolic 120 and diastolic 130, Complete mode must report BP_SYSTOLIC_GT_DIASTOLIC.",
  execution: "http",
  initialValues: {
    "vital.bp.systolic": 120,
    "vital.bp.diastolic": 130,
  },
  form: BP_FORM,
  rules: BP_RULES,
  expectedFacts: {
    validation: {
      isValid: false,
      errorCodes: ["BP_SYSTOLIC_GT_DIASTOLIC"],
      normalizedAnswers: {
        "vital.bp.systolic": 120,
        "vital.bp.diastolic": 130,
      },
    },
  },
};

const DYNAMIC_FORM: FormSchema = {
  schemaVersion: "1.0.0",
  fields: [
    {
      id: "household-size",
      code: "household.size",
      type: "integer",
      title: "Household size",
      minimum: 1,
      maximum: 8,
    },
    {
      id: "guardian-name",
      code: "household.guardianName",
      type: "text",
      title: "Guardian name",
    },
    {
      id: "support-note",
      code: "household.supportNote",
      type: "textarea",
      title: "Support note",
    },
    {
      id: "household-capacity",
      code: "household.capacity",
      type: "number",
      title: "Calculated capacity",
      readOnly: true,
      multipleOf: 1,
    },
  ],
};

const DYNAMIC_RULES: RulesSchema = {
  schemaVersion: "1.0.0",
  formSchemaVersion: "1.0.0",
  fields: {
    "guardian-name": {
      visibleWhen: { op: "gte", args: [{ ref: "household.size" }, { lit: 2 }] },
      enabledWhen: { op: "gte", args: [{ ref: "household.size" }, { lit: 2 }] },
      requiredWhen: { op: "gte", args: [{ ref: "household.size" }, { lit: 2 }] },
    },
    "household-capacity": {
      calculate: {
        op: "mul",
        args: [{ ref: "household.size" }, { lit: 2 }],
      },
    },
  },
};

const DYNAMIC_EXPECTED_FACTS: SampleExpectedFacts = {
  visibility: { "guardian-name": true },
  enabled: { "guardian-name": true },
  required: { "guardian-name": true },
  calculatedValues: { "household.capacity": 6 },
};

export const DYNAMIC_SAMPLE: SampleDefinition = {
  id: "dynamic-household",
  name: "Dynamic household rules",
  summary: "Visibility, enablement, required state, and a calculated capacity respond together.",
  expected:
    "With household size 3, Guardian name is visible, enabled, and required; capacity is 6.",
  execution: "http",
  initialValues: {
    "household.size": 3,
    "household.guardianName": "Sam Rivera",
    "household.supportNote": "Keep the calculated capacity visible while editing.",
  },
  form: DYNAMIC_FORM,
  rules: DYNAMIC_RULES,
  expectedFacts: DYNAMIC_EXPECTED_FACTS,
};

const ACCESS_FORM: FormSchema = {
  schemaVersion: "1.0.0",
  fields: [
    {
      id: "access-profile",
      code: "access",
      type: "group",
      title: "Access profile",
      items: [
        {
          id: "regions",
          code: "access.regions",
          type: "choice",
          title: "Regions",
          allowMultiple: true,
          required: true,
          options: [
            { value: "eu", label: "Europe" },
            { value: "us", label: "United States" },
            { value: "apac", label: "Asia Pacific" },
          ],
        },
        {
          id: "members",
          code: "access.members",
          type: "repeater",
          title: "Members",
          minItems: 1,
          maxItems: 3,
          items: [
            {
              id: "member-name",
              code: "access.members.name",
              type: "text",
              title: "Member name",
              required: true,
            },
            {
              id: "member-role",
              code: "access.members.role",
              type: "choice",
              title: "Member role",
              required: true,
              options: [
                { value: "owner", label: "Owner" },
                { value: "reviewer", label: "Reviewer" },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const ACCESS_RULES: RulesSchema = {
  schemaVersion: "1.0.0",
  formSchemaVersion: "1.0.0",
  fields: {},
};

export const ACCESS_SAMPLE: SampleDefinition = {
  id: "access-matrix",
  name: "Nested access matrix",
  summary: "A group contains a multi-select and a repeater with prefilled row objects.",
  expected:
    "Regions keeps an array of selected codes; members stays an array of row objects keyed by child codes.",
  execution: "http",
  initialValues: {
    "access.regions": ["eu", "apac"],
    "access.members": [
      {
        "access.members.name": "Ada Lovelace",
        "access.members.role": "owner",
      },
      {
        "access.members.name": "Grace Hopper",
        "access.members.role": "reviewer",
      },
    ],
  },
  form: ACCESS_FORM,
  rules: ACCESS_RULES,
  expectedFacts: {
    answerCodes: ["access.regions", "access.members", "access.members.name", "access.members.role"],
  },
};

const ADDRESS_COMPONENT_FORM_JSON = `{
  "schemaVersion": "1.0.0",
  "fields": [
    {"id":"street","code":"address.street","type":"text","title":"Street"},
    {"id":"postal","code":"address.postal","type":"text","title":"Postal code"}
  ]
}`;

const ADDRESS_COMPONENT_UI_JSON =
  '{"schemaVersion":"1.0.0","fields":{"postal":{"hidden":true}},"layout":[{"type":"field","fieldId":"street","title":"Street address"}]}';

const ADDRESS_COMPONENT: ComponentReference = {
  code: "address-card",
  version: "1.0.0",
  formSchemaJson: ADDRESS_COMPONENT_FORM_JSON,
  uiSchemaJson: ADDRESS_COMPONENT_UI_JSON,
};

const COMPONENT_SAMPLE_FORM: FormSchema = {
  schemaVersion: "1.0.0",
  fields: [
    {
      id: "shipping-address",
      code: "shipping.address",
      type: "component-ref",
      componentCode: "address-card",
      componentVersion: "1.0.0",
      title: "Shipping address",
    },
  ],
};

const COMPONENT_SAMPLE_RULES: RulesSchema = {
  schemaVersion: "1.0.0",
  formSchemaVersion: "1.0.0",
  fields: {},
};

const COMPONENT_SAMPLE_UI: UiSchema = {
  schemaVersion: "1.0.0",
  fields: {
    postal: { hidden: true },
  },
  layout: [{ type: "field", fieldId: "street", title: "Street address" }],
};

export const COMPONENT_SAMPLE: SampleDefinition = {
  id: "component-address",
  name: "Component reference",
  summary: "A caller-supplied component version expands into a renderable address group.",
  expected:
    "The address-card 1.0.0 component expands to address.street and address.postal; the UI-hidden answer stays retained.",
  execution: "http",
  components: [ADDRESS_COMPONENT],
  ui: COMPONENT_SAMPLE_UI,
  initialValues: {
    "address.street": "1 Market Street",
    "address.postal": "94105",
  },
  form: COMPONENT_SAMPLE_FORM,
  rules: COMPONENT_SAMPLE_RULES,
  expectedFacts: {
    expandedComponentCodes: ["address-card"],
    answerCodes: ["address.street", "address.postal"],
  },
};

/** Shared scalar-only casework documents; array-bearing answers stay in the separate access sample. */
const CASEWORK_CONTEXT_FORM_JSON = JSON.stringify({
  schemaVersion: "1.0.0",
  fields: [
    {
      id: "casework-contact-group",
      code: "casework.context.contact",
      type: "group",
      title: "Contact details",
      items: [
        {
          id: "casework-contact-method",
          code: "casework.context.contact.method",
          type: "choice",
          title: "Preferred contact method",
          options: [
            { value: "email", label: "Email" },
            { value: "phone", label: "Phone" },
          ],
        },
        {
          id: "casework-contact-value",
          code: "casework.context.contact.value",
          type: "text",
          title: "Contact value",
        },
      ],
    },
    {
      id: "casework-household-group",
      code: "casework.context.household",
      type: "group",
      title: "Household facts",
      items: [
        {
          id: "casework-household-size",
          code: "casework.context.household.size",
          type: "integer",
          title: "Household size",
          minimum: 1,
          maximum: 8,
        },
        {
          id: "casework-household-income",
          code: "casework.context.household.income",
          type: "number",
          title: "Annual income",
          minimum: 0,
        },
      ],
    },
  ],
}) as string;

const CASEWORK_CONTEXT_UI_JSON = JSON.stringify({
  schemaVersion: "1.0.0",
  formSchemaVersion: "1.0.0",
  fields: {
    "casework-contact-value": { label: "Email address or phone number" },
  },
}) as string;

const CASEWORK_CONTEXT_COMPONENT: ComponentReference = {
  code: "casework-context",
  version: "1.0.0",
  formSchemaJson: CASEWORK_CONTEXT_FORM_JSON,
  uiSchemaJson: CASEWORK_CONTEXT_UI_JSON,
};

const CASEWORK_COMPONENTS: readonly ComponentReference[] = [CASEWORK_CONTEXT_COMPONENT];

const CASEWORK_FORM: FormSchema = {
  schemaVersion: "1.0.0",
  fields: [
    {
      id: "casework-intake",
      code: "casework.intake",
      type: "group",
      title: "Eligibility casework intake",
      items: [
        {
          id: "casework-status",
          code: "casework.status",
          type: "choice",
          title: "Case status",
          options: [
            { value: "standard", label: "Standard" },
            { value: "review", label: "Review" },
            { value: "expedited", label: "Expedited" },
          ],
        },
        {
          id: "casework-context",
          code: "casework.context",
          type: "component-ref",
          componentCode: "casework-context",
          componentVersion: "1.0.0",
          title: "Applicant context",
        },
        {
          id: "casework-review-reason",
          code: "casework.reviewReason",
          type: "textarea",
          title: "Review reason",
        },
        {
          id: "casework-adjusted-income",
          code: "casework.calculations.adjustedIncome",
          type: "number",
          title: "Adjusted income",
          readOnly: true,
        },
        {
          id: "casework-household-total",
          code: "casework.calculations.householdTotal",
          type: "number",
          title: "Household total",
          readOnly: true,
        },
        {
          id: "casework-eligibility-score",
          code: "casework.calculations.eligibilityScore",
          type: "integer",
          title: "Eligibility score",
          readOnly: true,
        },
      ],
    },
  ],
};

const CASEWORK_UI: UiSchema = {
  schemaVersion: "1.0.0",
  formSchemaVersion: "1.0.0",
  fields: {
    "casework-status": { description: "Choose the workflow state for this intake." },
    "casework-review-reason": {
      description: "Required when the case status is Review.",
    },
  },
};

const REVIEW_CASE_CONDITION = {
  op: "eq",
  args: [{ ref: "casework.status" }, { lit: "review" }],
} as const;

const PHONE_CONTACT_CONDITION = {
  op: "eq",
  args: [{ ref: "casework.context.contact.method" }, { lit: "phone" }],
} as const;

const CASEWORK_RULES: RulesSchema = {
  schemaVersion: "1.0.0",
  formSchemaVersion: "1.0.0",
  fields: {
    "casework-review-reason": {
      visibleWhen: REVIEW_CASE_CONDITION,
      enabledWhen: REVIEW_CASE_CONDITION,
      requiredWhen: REVIEW_CASE_CONDITION,
    },
    "casework-contact-value": {
      visibleWhen: PHONE_CONTACT_CONDITION,
      enabledWhen: PHONE_CONTACT_CONDITION,
      requiredWhen: PHONE_CONTACT_CONDITION,
    },
    "casework-adjusted-income": {
      calculate: {
        op: "add",
        args: [{ ref: "casework.context.household.income" }, { lit: 250 }],
      },
    },
    "casework-household-total": {
      calculate: {
        op: "mul",
        args: [
          { ref: "casework.calculations.adjustedIncome" },
          { ref: "casework.context.household.size" },
        ],
      },
    },
    "casework-eligibility-score": {
      calculate: {
        op: "sub",
        args: [{ ref: "casework.calculations.householdTotal" }, { lit: 1000 }],
      },
    },
  },
  validations: [
    {
      code: "CASEWORK_HIGH_INCOME_REQUIRES_REVIEW",
      message: "Income above 1500 requires review",
      when: {
        op: "gt",
        args: [{ ref: "casework.context.household.income" }, { lit: 1500 }],
      },
      assert: {
        op: "lte",
        args: [{ ref: "casework.context.household.income" }, { lit: 1500 }],
      },
    },
    {
      code: "CASEWORK_LARGE_HOUSEHOLD_REQUIRES_REVIEW",
      message: "Household size above four requires review",
      when: {
        op: "gt",
        args: [{ ref: "casework.context.household.size" }, { lit: 4 }],
      },
      assert: {
        op: "lte",
        args: [{ ref: "casework.context.household.size" }, { lit: 4 }],
      },
    },
  ],
};

const CASEWORK_INITIAL_VALUES: Record<string, unknown> = {
  "casework.status": "review",
  "casework.context.contact.method": "phone",
  "casework.context.contact.value": "+1 555 0100",
  "casework.context.household.size": 3,
  "casework.context.household.income": 1200,
  "casework.reviewReason": "Household size and income need a benefits review.",
};

const CASEWORK_EXPECTED_FACTS: SampleExpectedFacts = {
  visibility: {
    "casework-review-reason": true,
    "casework-contact-value": true,
  },
  enabled: {
    "casework-review-reason": true,
    "casework-contact-value": true,
  },
  required: {
    "casework-review-reason": true,
    "casework-contact-value": true,
  },
  calculatedValues: {
    "casework.calculations.adjustedIncome": 1450,
    "casework.calculations.householdTotal": 4350,
    "casework.calculations.eligibilityScore": 3350,
  },
  answerCodes: [
    "casework.status",
    "casework.context.contact.method",
    "casework.context.contact.value",
    "casework.context.household.size",
    "casework.context.household.income",
    "casework.reviewReason",
    "casework.calculations.adjustedIncome",
    "casework.calculations.householdTotal",
    "casework.calculations.eligibilityScore",
  ],
  expandedComponentCodes: ["casework-context"],
  validation: {
    isValid: true,
    errorCodes: [],
  },
};

const CASEWORK_EXPECTED =
  "A review case expands its caller-supplied context component, keeps phone contact and review reason required, and completes with adjusted income 1450, household total 4350, and eligibility score 3350.";

/** The HTTP and direct-WASM entries intentionally share the same documents and expected facts. */
export const CASEWORK_SAMPLE: SampleDefinition = {
  id: "casework-intake",
  name: "Eligibility casework intake · HTTP",
  summary:
    "An extreme scalar eligibility intake exercises nested component expansion, conditional rules, chained calculations, and stable review validations.",
  expected: CASEWORK_EXPECTED,
  execution: "http",
  components: CASEWORK_COMPONENTS,
  ui: CASEWORK_UI,
  initialValues: CASEWORK_INITIAL_VALUES,
  form: CASEWORK_FORM,
  rules: CASEWORK_RULES,
  expectedFacts: CASEWORK_EXPECTED_FACTS,
};

export const WASM_CASEWORK_SAMPLE: SampleDefinition = {
  id: "wasm-casework-intake",
  name: "Eligibility casework intake · direct WASM",
  summary:
    "The same casework documents run through the packed browser core without an HTTP forms request.",
  expected: CASEWORK_EXPECTED,
  execution: "wasm",
  components: CASEWORK_COMPONENTS,
  ui: CASEWORK_UI,
  initialValues: CASEWORK_INITIAL_VALUES,
  form: CASEWORK_FORM,
  rules: CASEWORK_RULES,
  expectedFacts: CASEWORK_EXPECTED_FACTS,
};

export const WASM_BMI_SAMPLE: SampleDefinition = {
  id: "wasm-bmi",
  name: "BMI · direct WASM",
  summary: "The same calculation runs through the packed browser binding, with no Nest request.",
  expected: "Weight 70 kg and height 1.75 m must yield BMI 22.86 through the direct WASM source.",
  execution: "wasm",
  initialValues: {
    "body.weight.kg": 70,
    "body.height.m": 1.75,
  },
  form: BMI_FORM,
  rules: BMI_RULES,
  expectedFacts: {
    calculatedValues: { "body.bmi": 22.86 },
    enabled: { bmi: false },
  },
};

export const WASM_DYNAMIC_SAMPLE: SampleDefinition = {
  id: "wasm-dynamic-household",
  name: "Dynamic household · direct WASM",
  summary: "The hard dynamic-rule path runs in the browser without an HTTP transport.",
  expected:
    "With household size 3, the direct WASM source keeps Guardian name visible, enabled, and required; capacity is 6.",
  execution: "wasm",
  initialValues: {
    "household.size": 3,
    "household.guardianName": "Sam Rivera",
    "household.supportNote": "This sample does not call the NestJS API.",
  },
  form: DYNAMIC_FORM,
  rules: DYNAMIC_RULES,
  expectedFacts: DYNAMIC_EXPECTED_FACTS,
};

export const SAMPLES: SampleDefinition[] = [
  BMI_SAMPLE,
  BP_SAMPLE,
  DYNAMIC_SAMPLE,
  ACCESS_SAMPLE,
  COMPONENT_SAMPLE,
  CASEWORK_SAMPLE,
  WASM_CASEWORK_SAMPLE,
  WASM_BMI_SAMPLE,
  WASM_DYNAMIC_SAMPLE,
];

export const DEFAULT_SAMPLE_ID = BMI_SAMPLE.id;

export function findSample(id: string): SampleDefinition {
  return SAMPLES.find((sample) => sample.id === id) ?? BMI_SAMPLE;
}

/**
 * Strict lookup for routing: an unknown id stays unknown instead of silently
 * becoming the default sample, so a mistyped URL can be reported as not found.
 */
export function findSampleOrUndefined(id: string): SampleDefinition | undefined {
  return SAMPLES.find((sample) => sample.id === id);
}

/** Serialize sample objects once, including caller-owned component references. */
export function createSampleCompileRequest(
  sample: Pick<SampleDefinition, "form" | "rules" | "ui" | "components">,
): CompileRequest {
  return createCompileRequest({
    form: sample.form,
    rules: sample.rules,
    ui: sample.ui,
    components: sample.components,
  });
}
