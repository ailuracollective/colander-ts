import { expectTypeOf, test } from "vitest";

import {
  ColanderTransportError,
  applyEvaluation,
  createFormDefinitionFromCompiled,
  createFormDefinitionFromDescribed,
  createRuleState,
  createValidateResponseRequest,
} from "../src/index.js";
import type {
  ColanderErrorBody,
  ColanderErrorKind,
  ColanderFailureBody,
  ColanderEvent,
  ColanderEventListener,
  ColanderEventSource,
  ColanderTransport,
  ColanderTransportErrorKind,
  ColanderTransportErrorOptions,
  CompileRequest,
  ComponentReference,
  CompiledForm,
  ContentHashRequest,
  CoreInfo,
  DescribeFormRequest,
  DescribedForm,
  DescribedDefinitionInput,
  EvaluateRulesRequest,
  FormDefinition,
  FormSchema,
  RulesSchema,
  UiSchema,
  FormDefinitionInput,
  FormNode,
  NextVersionRequest,
  ResponseValidation,
  RuleEvaluation,
  RuleIndex,
  RuleState,
  SchemaCheck,
  ValidateResponseRequest,
  ValidateSchemaRequest,
  ValidationMode,
  ValidationError,
  VersionInfo,
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
    }),
  coreInfo: CoreInfo = {
    abiVersion: 1,
    versionInfo: { abi: 1, name: "colander", version: "0.1.0" },
  },
  compiledForm: CompiledForm = {
    contentHash: "abc123",
    dependencyMetadataJson: "{}",
    formSchemaJson: '{"fields":[]}',
    rulesSchemaJson: null,
    uiSchemaJson: null,
  },
  validationError: ValidationError = {
    code: "invalid",
    message: "Invalid value",
  },
  ruleEvaluation: RuleEvaluation = {
    calculatedValues: { total: 3 },
    enabled: { field: true },
    required: { field: false },
    validationErrors: [validationError],
    visibility: { field: true },
  },
  responseValidation: ResponseValidation = {
    errors: [],
    isValid: true,
    normalizedAnswersJson: '{"value":3}',
  },
  schemaCheck: SchemaCheck = { valid: true },
  fakeTransport = {
    compile: async (_request) => compiledForm,
    contentHash: async (_request) => compiledForm.contentHash,
    describeForm: async (_request): Promise<DescribedForm> => ({
      contentHash: compiledForm.contentHash,
      fields: [],
    }),
    evaluateRules: async (_request) => ruleEvaluation,
    getCore: async () => coreInfo,
    nextVersion: async (_request = {}) => "0.1.1",
    validateResponse: async (_request) => responseValidation,
    validateSchema: async (_request): Promise<SchemaCheck> => schemaCheck,
  } satisfies ColanderTransport;

test("exposes precise transport request and result types", () => {
  expectTypeOf(fakeTransport).toMatchTypeOf<ColanderTransport>();
  expectTypeOf(fakeTransport.describeForm).parameter(0).toEqualTypeOf<DescribeFormRequest>();
  expectTypeOf(fakeTransport.describeForm).returns.toEqualTypeOf<Promise<DescribedForm>>();
  expectTypeOf(fakeTransport.compile).parameter(0).toEqualTypeOf<CompileRequest>();
  expectTypeOf(fakeTransport.compile).returns.toEqualTypeOf<Promise<CompiledForm>>();
  expectTypeOf(fakeTransport.contentHash).parameter(0).toEqualTypeOf<ContentHashRequest>();
  expectTypeOf(fakeTransport.contentHash).returns.toEqualTypeOf<Promise<string>>();
  expectTypeOf(fakeTransport.evaluateRules).parameter(0).toEqualTypeOf<EvaluateRulesRequest>();
  expectTypeOf(fakeTransport.evaluateRules).returns.toEqualTypeOf<Promise<RuleEvaluation>>();
  expectTypeOf(fakeTransport.validateResponse)
    .parameter(0)
    .toEqualTypeOf<ValidateResponseRequest>();
  expectTypeOf(fakeTransport.validateResponse).returns.toEqualTypeOf<Promise<ResponseValidation>>();
  expectTypeOf(fakeTransport.validateSchema).parameter(0).toEqualTypeOf<ValidateSchemaRequest>();
  expectTypeOf(fakeTransport.validateSchema).returns.toEqualTypeOf<Promise<SchemaCheck>>();
  expectTypeOf(fakeTransport.nextVersion)
    .parameter(0)
    .toEqualTypeOf<NextVersionRequest | undefined>();
  expectTypeOf(fakeTransport.nextVersion).returns.toEqualTypeOf<Promise<string>>();
});

test("infers event payload types through listeners and sources", () => {
  interface Payload {
    readonly formId: string;
  }

  const listener: ColanderEventListener<Payload> = (event) => {
      expectTypeOf(event).toEqualTypeOf<ColanderEvent<Payload>>();
      expectTypeOf(event.payload.formId).toEqualTypeOf<string>();
    },
    source: ColanderEventSource<Payload> = {
      subscribe(nextListener) {
        expectTypeOf(nextListener).toEqualTypeOf<ColanderEventListener<Payload>>();
        return () => {};
      },
    },
    event = {
      payload: { formId: "form-1" },
      type: "form.changed",
    } satisfies ColanderEvent<Payload>;

  expectTypeOf<ColanderEventSource>().toEqualTypeOf<ColanderEventSource>();
  expectTypeOf<ColanderEventListener>().toMatchTypeOf<ColanderEventListener<Payload>>();
  expectTypeOf<ColanderEventListener<Payload>>().not.toMatchTypeOf<ColanderEventListener>();
  type IsAssignable<From, To> = [From] extends [To] ? true : false;
  expectTypeOf<
    IsAssignable<ColanderEventSource, ColanderEventSource<Payload>>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    IsAssignable<ColanderEventSource<Payload>, ColanderEventSource>
  >().toEqualTypeOf<true>();
  expectTypeOf(event.payload.formId).toEqualTypeOf<string>();
  source.subscribe(listener);
  source.subscribe((received) => {
    expectTypeOf(received.payload.formId).toEqualTypeOf<string>();
  });
  expectTypeOf(event).toMatchTypeOf<ColanderEvent<Payload>>();
});

test("keeps the object-first and compiled-boundary APIs precise", () => {
  const input: FormDefinitionInput = {
      form: { fields: [] },
      rules: null,
      ui: null,
    },
    definition = define(input),
    request = createValidateResponseRequest(
      compiledForm,
      definition,
      { "body.weight.kg": 70, rows: [{ "rows.name": "Ada" }] },
      "Complete",
    );

  expectTypeOf(createFormDefinitionFromDescribed)
    .parameter(0)
    .toEqualTypeOf<DescribedDefinitionInput>();
  expectTypeOf<string>().not.toMatchTypeOf<FormDefinitionInput>();
  expectTypeOf(createFormDefinitionFromCompiled).parameter(0).toEqualTypeOf<CompiledForm>();
  expectTypeOf(createFormDefinitionFromCompiled).parameter(1).toEqualTypeOf<DescribedForm>();
  expectTypeOf(createValidateResponseRequest).returns.toEqualTypeOf<ValidateResponseRequest>();
  expectTypeOf(request).toEqualTypeOf<ValidateResponseRequest>();
  expectTypeOf(request.answersJson).toEqualTypeOf<string>();
});

test("preserves known answers while widening calculated values truthfully", () => {
  const definition = define({ form: { fields: [] } }),
    answers = { count: 2, name: "Ada" } as const,
    initialState = createRuleState(answers, definition);
  expectTypeOf(initialState.values).toEqualTypeOf<typeof answers>();

  const evaluation = {
      calculatedValues: { count: "two", total: 3 },
      enabled: {},
      required: {},
      validationErrors: [],
      visibility: {},
    } satisfies RuleEvaluation<{ count: string; total: number }>,
    state = applyEvaluation(answers, evaluation, definition);
  expectTypeOf(state.values.name).toEqualTypeOf<"Ada">();
  expectTypeOf(state.values.count).toEqualTypeOf<string>();
  expectTypeOf(state.values.total).toEqualTypeOf<number>();
  expectTypeOf(state).toMatchTypeOf<
    RuleState<{
      name: "Ada";
      count: string;
      total: number;
    }>
  >();
});

test("keeps rule indexes aligned with form definitions", () => {
  const definition = define({ form: { fields: [] } }),
    index: RuleIndex = definition;

  expectTypeOf(index).toEqualTypeOf<RuleIndex>();
  expectTypeOf(definition).toMatchTypeOf<RuleIndex>();
  expectTypeOf<RuleIndex["calculatedCodes"]>().toEqualTypeOf<ReadonlySet<string>>();
  expectTypeOf<RuleIndex["fieldIds"]>().toEqualTypeOf<readonly string[]>();
  expectTypeOf(definition).toEqualTypeOf<FormDefinition>();
  expectTypeOf(definition.root).toEqualTypeOf<readonly FormNode[]>();
});

test("keeps exported error, event, and form unions precise", () => {
  const errorOptions = {
      detail: "The value is invalid",
      kind: "validation",
    } satisfies ColanderTransportErrorOptions<"validation">,
    error = new ColanderTransportError("invalid", errorOptions);

  expectTypeOf(error).toEqualTypeOf<ColanderTransportError<"validation">>();
  expectTypeOf(error.kind).toEqualTypeOf<"validation">();
  expectTypeOf<ColanderTransportErrorKind>().toEqualTypeOf<
    ColanderErrorKind | "unavailable" | "network" | "operation" | "unknown"
  >();
  expectTypeOf<ColanderErrorBody["kind"]>().toEqualTypeOf<ColanderErrorKind>();
  expectTypeOf<ColanderFailureBody["kind"]>().toEqualTypeOf<ColanderTransportErrorKind>();
  expectTypeOf<ValidationMode>().toEqualTypeOf<"Draft" | "Complete">();
  expectTypeOf<SchemaCheck>().toEqualTypeOf<
    { readonly valid: true } | { readonly valid: false; readonly message: string }
  >();
  expectTypeOf<ColanderEvent<{ id: string }>["payload"]>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<FormDefinition["root"]>().toEqualTypeOf<readonly FormNode[]>();
  expectTypeOf<CompileRequest["components"]>().toEqualTypeOf<
    readonly ComponentReference[] | undefined
  >();
  expectTypeOf<RuleEvaluation["validationErrors"]>().toEqualTypeOf<readonly ValidationError[]>();
  expectTypeOf<RuleEvaluation["visibility"]>().toEqualTypeOf<Readonly<Record<string, boolean>>>();
  expectTypeOf<Extract<FormNode, { kind: "group" }>["children"]>().toEqualTypeOf<
    readonly FormNode[]
  >();
  expectTypeOf<VersionInfo>().toEqualTypeOf<{
    readonly name: string;
    readonly version: string;
    readonly abi: number;
  }>();
});
