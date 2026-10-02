import { readFile, stat } from "node:fs/promises";

import { ColanderError, type LoadedCore } from "@ailura/colander";
import {
  createEvaluateRulesRequest,
  createFormDefinitionFromCompiled,
  createValidateResponseRequest,
  resolveFieldForPath,
  type ColanderTransport,
  type CompileRequest,
  type CompiledForm,
  type ContentHashRequest,
  type EvaluateRulesRequest,
  type FormDefinition,
  type FormNode,
  type NextVersionRequest,
  type ValidateResponseRequest,
  type ValidateSchemaRequest,
} from "@ailura/colander-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCESS_SAMPLE,
  BP_SAMPLE,
  CASEWORK_SAMPLE,
  COMPONENT_SAMPLE,
  WASM_BMI_SAMPLE,
  WASM_CASEWORK_SAMPLE,
  WASM_DYNAMIC_SAMPLE,
  createSampleCompileRequest,
} from "../samples";
import { createWasmColanderTransport } from "./wasm-colander-transport";

const compiledFixture = {
  formSchemaJson: '{"fields":[]}',
  uiSchemaJson: null,
  rulesSchemaJson: null,
  dependencyMetadataJson: "{}",
  contentHash: "fixture-hash",
} as const;

function makeCore(overrides: Partial<LoadedCore> = {}): LoadedCore {
  return {
    get abiVersion() {
      return 1;
    },
    compile: vi.fn(() => compiledFixture),
    contentHash: vi.fn(() => "fixture-hash"),
    evaluateRules: vi.fn(() => ({
      visibility: {},
      enabled: {},
      required: {},
      calculatedValues: {},
      validationErrors: [],
    })),
    validateResponse: vi.fn(() => ({
      normalizedAnswersJson: "{}",
      errors: [],
      isValid: true,
    })),
    validateSchema: vi.fn(() => ({ valid: true })),
    nextVersion: vi.fn(() => "1.0.1"),
    versionInfo: vi.fn(() => ({ name: "fake", version: "0.0.0", abi: 1 })),
    ...overrides,
  } as unknown as LoadedCore;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectCompiledFields(
  fields: readonly Record<string, unknown>[],
): Array<Record<string, unknown>> {
  const collected: Array<Record<string, unknown>> = [];
  for (const field of fields) {
    collected.push(field);
    if (Array.isArray(field["items"])) {
      collected.push(...collectCompiledFields(field["items"].filter(isRecord)));
    }
  }
  return collected;
}

function flattenNodes(nodes: readonly FormNode[]): FormNode[] {
  return nodes.flatMap((node) =>
    node.kind === "field" ? [node] : [node, ...flattenNodes(node.children)],
  );
}

/**
 * The real core describes the real compiled form, so these tests exercise the
 * published contract rather than a stand-in. A wrong reading of a description
 * in the client would fail the pointer assertions below.
 */
async function definitionFor(
  transport: ColanderTransport,
  compiled: CompiledForm,
  request: CompileRequest,
): Promise<FormDefinition> {
  return createFormDefinitionFromCompiled(compiled, await transport.describeForm(request));
}

describe("wasmColanderTransport", () => {
  it("shares one in-flight load across concurrent callers", async () => {
    const core = makeCore();
    let resolveCore: ((value: LoadedCore) => void) | undefined;
    const loadCore = vi.fn(
      () =>
        new Promise<LoadedCore>((resolve) => {
          resolveCore = resolve;
        }),
    );
    const transport = createWasmColanderTransport({ loadCore });

    const first = transport.getCore();
    const second = transport.getCore();
    await Promise.resolve();
    expect(loadCore).toHaveBeenCalledTimes(1);

    resolveCore?.(core);
    await expect(first).resolves.toEqual({
      abiVersion: 1,
      versionInfo: { name: "fake", version: "0.0.0", abi: 1 },
    });
    await expect(second).resolves.toEqual({
      abiVersion: 1,
      versionInfo: { name: "fake", version: "0.0.0", abi: 1 },
    });
    expect(loadCore).toHaveBeenCalledTimes(1);
  });

  it("clears a rejected load so the next call can retry", async () => {
    const core = makeCore();
    const loadCore = vi
      .fn<() => Promise<LoadedCore>>()
      .mockRejectedValueOnce(new Error("WASM asset is unavailable"))
      .mockResolvedValueOnce(core);
    const transport = createWasmColanderTransport({ loadCore });

    await expect(transport.getCore()).rejects.toMatchObject({ kind: "unavailable" });
    await expect(transport.getCore()).resolves.toMatchObject({ abiVersion: 1 });
    expect(loadCore).toHaveBeenCalledTimes(2);
  });

  it("does not cache a core after a real panic", async () => {
    const trappedCore = makeCore({
      evaluateRules: vi.fn(() => {
        throw new ColanderError("panic", "simulated WebAssembly trap");
      }),
    });
    const recoveredCore = makeCore();
    const loadCore = vi
      .fn<() => Promise<LoadedCore>>()
      .mockResolvedValueOnce(trappedCore)
      .mockResolvedValueOnce(recoveredCore);
    const transport = createWasmColanderTransport({ loadCore });
    const request: EvaluateRulesRequest = {
      formSchemaJson: '{"fields":[]}',
      rulesSchemaJson: '{"fields":{}}',
      values: {},
    };

    await expect(transport.evaluateRules(request)).rejects.toMatchObject({ kind: "panic" });
    await expect(transport.evaluateRules(request)).resolves.toMatchObject({
      calculatedValues: {},
    });
    expect(loadCore).toHaveBeenCalledTimes(2);
  });

  it("forwards every request object unchanged", async () => {
    const compile = vi.fn((_request: CompileRequest) => compiledFixture);
    const contentHash = vi.fn((_request: ContentHashRequest) => "fixture-hash");
    const evaluateRules = vi.fn((_request: EvaluateRulesRequest) => ({
      visibility: {},
      enabled: {},
      required: {},
      calculatedValues: {},
      validationErrors: [],
    }));
    const validateResponse = vi.fn((_request: ValidateResponseRequest) => ({
      normalizedAnswersJson: "{}",
      errors: [],
      isValid: true,
    }));
    const validateSchema = vi.fn(
      (_request: ValidateSchemaRequest) =>
        ({
          valid: true,
        }) as const,
    );
    const nextVersion = vi.fn((_request?: NextVersionRequest) => "1.0.1");
    const core = makeCore({
      compile,
      contentHash,
      evaluateRules,
      validateResponse,
      validateSchema,
      nextVersion,
    });
    const transport = createWasmColanderTransport({ loadCore: async () => core });
    const compileRequest: CompileRequest = { formSchemaJson: '{"fields":[]}' };
    const contentHashRequest: ContentHashRequest = { formSchemaJson: '{"fields":[]}' };
    const evaluateRequest: EvaluateRulesRequest = {
      formSchemaJson: '{"fields":[]}',
      rulesSchemaJson: '{"fields":{}}',
      values: { value: "kept" },
    };
    const responseRequest: ValidateResponseRequest = {
      formSchemaJson: '{"fields":[]}',
      answersJson: '{"value":"kept"}',
    };
    const schemaRequest: ValidateSchemaRequest = { kind: "instance", instanceJson: "{}" };
    const versionRequest: NextVersionRequest = { published: ["1.0.0"] };

    await transport.compile(compileRequest);
    await transport.contentHash(contentHashRequest);
    await transport.evaluateRules(evaluateRequest);
    await transport.validateResponse(responseRequest);
    await transport.validateSchema(schemaRequest);
    await transport.nextVersion(versionRequest);

    expect(compile).toHaveBeenCalledWith(compileRequest);
    expect(compile.mock.calls[0]?.[0]).toBe(compileRequest);
    expect(contentHash).toHaveBeenCalledWith(contentHashRequest);
    expect(contentHash.mock.calls[0]?.[0]).toBe(contentHashRequest);
    expect(evaluateRules).toHaveBeenCalledWith(evaluateRequest);
    expect(evaluateRules.mock.calls[0]?.[0]).toBe(evaluateRequest);
    expect(validateResponse).toHaveBeenCalledWith(responseRequest);
    expect(validateResponse.mock.calls[0]?.[0]).toBe(responseRequest);
    expect(validateSchema).toHaveBeenCalledWith(schemaRequest);
    expect(validateSchema.mock.calls[0]?.[0]).toBe(schemaRequest);
    expect(nextVersion).toHaveBeenCalledWith(versionRequest);
    expect(nextVersion.mock.calls[0]?.[0]).toBe(versionRequest);
  });

  it("preserves a core validation error kind", async () => {
    const transport = createWasmColanderTransport();

    try {
      await transport.compile({ formSchemaJson: "not json" });
      throw new Error("expected compile to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ColanderError);
      expect((error as ColanderError).kind).toBe("validation");
    }
  });

  it("uses the real packed WASM without an HTTP call and covers hard samples", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const transport = createWasmColanderTransport();

    try {
      const [firstCore, secondCore] = await Promise.all([transport.getCore(), transport.getCore()]);
      expect(firstCore).toEqual(secondCore);
      expect(firstCore.abiVersion).toBe(1);
      expect(firstCore.versionInfo).toMatchObject({ name: "colander", abi: 1 });
      expect(fetchSpy).not.toHaveBeenCalled();

      const bmi = await transport.compile(createSampleCompileRequest(WASM_BMI_SAMPLE));
      const bmiDefinition = await definitionFor(
        transport,
        bmi,
        createSampleCompileRequest(WASM_BMI_SAMPLE),
      );
      const bmiEvaluation = await transport.evaluateRules(
        createEvaluateRulesRequest(bmi, bmiDefinition, WASM_BMI_SAMPLE.initialValues),
      );
      expect(bmiEvaluation.calculatedValues).toEqual(
        WASM_BMI_SAMPLE.expectedFacts.calculatedValues,
      );

      const bp = await transport.compile(createSampleCompileRequest(BP_SAMPLE));
      const bpDefinition = await definitionFor(
        transport,
        bp,
        createSampleCompileRequest(BP_SAMPLE),
      );
      const bpValidation = await transport.validateResponse(
        createValidateResponseRequest(bp, bpDefinition, BP_SAMPLE.initialValues, "Complete"),
      );
      expect(bpValidation.isValid).toBe(false);
      expect(bpValidation.errors.map((error) => error.code)).toEqual(
        BP_SAMPLE.expectedFacts.validation?.errorCodes,
      );

      const dynamic = await transport.compile(createSampleCompileRequest(WASM_DYNAMIC_SAMPLE));
      const dynamicDefinition = await definitionFor(
        transport,
        dynamic,
        createSampleCompileRequest(WASM_DYNAMIC_SAMPLE),
      );
      const dynamicEvaluation = await transport.evaluateRules(
        createEvaluateRulesRequest(dynamic, dynamicDefinition, WASM_DYNAMIC_SAMPLE.initialValues),
      );
      expect(dynamicEvaluation.visibility).toMatchObject(
        WASM_DYNAMIC_SAMPLE.expectedFacts.visibility ?? {},
      );
      expect(dynamicEvaluation.enabled).toMatchObject(
        WASM_DYNAMIC_SAMPLE.expectedFacts.enabled ?? {},
      );
      expect(dynamicEvaluation.required).toMatchObject(
        WASM_DYNAMIC_SAMPLE.expectedFacts.required ?? {},
      );
      expect(dynamicEvaluation.calculatedValues).toEqual(
        WASM_DYNAMIC_SAMPLE.expectedFacts.calculatedValues,
      );

      const dynamicAnswers = {
        ...WASM_DYNAMIC_SAMPLE.initialValues,
        ...dynamicEvaluation.calculatedValues,
      };
      const dynamicValidation = await transport.validateResponse(
        createValidateResponseRequest(dynamic, dynamicDefinition, dynamicAnswers, "Complete"),
      );
      const normalizedDynamicAnswers = JSON.parse(
        dynamicValidation.normalizedAnswersJson,
      ) as Record<string, unknown>;
      expect(dynamicValidation.isValid).toBe(true);
      expect(dynamicValidation.errors.map((error) => error.code)).not.toContain(
        "CALCULATED_VALUE_MISMATCH",
      );
      expect(normalizedDynamicAnswers["household.capacity"]).toBe(6);

      const access = await transport.compile(createSampleCompileRequest(ACCESS_SAMPLE));
      const accessDefinition = await definitionFor(
        transport,
        access,
        createSampleCompileRequest(ACCESS_SAMPLE),
      );
      const accessEvaluation = await transport.evaluateRules(
        createEvaluateRulesRequest(access, accessDefinition, ACCESS_SAMPLE.initialValues),
      );
      expect(accessEvaluation.required).toMatchObject({
        regions: true,
        "member-role": true,
      });
      expect(accessEvaluation.validationErrors).toEqual([]);

      const component = await transport.compile(createSampleCompileRequest(COMPONENT_SAMPLE));
      const componentDefinition = await definitionFor(
        transport,
        component,
        createSampleCompileRequest(COMPONENT_SAMPLE),
      );
      const componentRoot = componentDefinition.root[0];
      expect(component.formSchemaJson).toContain("address.street");
      expect(componentRoot?.kind).toBe("group");
      if (componentRoot?.kind !== "group") {
        throw new Error("expected the expanded component group");
      }
      expect(componentRoot.children.map((child) => child.code)).toEqual([
        "address.street",
        "address.postal",
      ]);
      expect(componentDefinition.hiddenById.postal).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("runs the scalar casework intake through the packed core without HTTP calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const transport = createWasmColanderTransport();

    try {
      expect(createSampleCompileRequest(CASEWORK_SAMPLE)).toEqual(
        createSampleCompileRequest(WASM_CASEWORK_SAMPLE),
      );
      const compiled = await transport.compile(createSampleCompileRequest(WASM_CASEWORK_SAMPLE));
      const definition = await definitionFor(
        transport,
        compiled,
        createSampleCompileRequest(WASM_CASEWORK_SAMPLE),
      );
      const compiledForm = JSON.parse(compiled.formSchemaJson) as {
        fields: Array<Record<string, unknown>>;
      };
      const fields = collectCompiledFields(compiledForm.fields);
      const ids = fields
        .map((field) => field["id"])
        .filter((id): id is string => typeof id === "string");
      const codes = fields
        .map((field) => field["code"])
        .filter((code): code is string => typeof code === "string");
      const answerCodes = fields
        .filter((field) => field["type"] !== "group")
        .map((field) => field["code"])
        .filter((code): code is string => typeof code === "string");

      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(codes).size).toBe(codes.length);
      expect(answerCodes).toEqual(WASM_CASEWORK_SAMPLE.expectedFacts.answerCodes);
      expect(fields.some((field) => field["type"] === "component-ref")).toBe(false);
      expect(fields.some((field) => field["type"] === "repeater")).toBe(false);
      // The sample is single-valued throughout. Checked on the compiled fields
      // directly: the client no longer derives a per-code answer shape, because
      // the core owns the row and multi-value conversion.
      expect(fields.some((field) => field["allowMultiple"] === true)).toBe(false);

      const intake = definition.root.find((node) => node.code === "casework.intake");
      expect(intake).toMatchObject({ kind: "group", type: "group" });
      if (intake?.kind !== "group") {
        throw new Error("expected the casework intake group");
      }
      const context = intake.children.find((node) => node.code === "casework.context");
      expect(context).toMatchObject({ kind: "group", type: "group" });
      if (context?.kind !== "group") {
        throw new Error("expected the expanded casework context group");
      }
      const contact = context.children.find((node) => node.code === "casework.context.contact");
      expect(contact).toMatchObject({ kind: "group" });
      if (contact?.kind !== "group") {
        throw new Error("expected the nested contact group");
      }
      expect(contact.children.map((node) => node.code)).toEqual([
        "casework.context.contact.method",
        "casework.context.contact.value",
      ]);

      const metadata = JSON.parse(compiled.dependencyMetadataJson) as {
        components: Array<{ code: string; version: string }>;
        rules: {
          calculatedFieldIds: string[];
          evaluationOrder: string[];
        };
      };
      expect(metadata.components).toHaveLength(1);
      expect(metadata.components.map((component) => component.code)).toEqual(
        WASM_CASEWORK_SAMPLE.expectedFacts.expandedComponentCodes,
      );
      expect(metadata.components[0]).toMatchObject({
        code: "casework-context",
        version: "1.0.0",
      });
      expect(metadata.rules.evaluationOrder).toEqual([
        "casework-adjusted-income",
        "casework-household-total",
        "casework-eligibility-score",
      ]);
      expect(new Set(metadata.rules.calculatedFieldIds)).toEqual(
        new Set([
          "casework-adjusted-income",
          "casework-household-total",
          "casework-eligibility-score",
        ]),
      );
      expect(definition.calculatedCodes).toEqual(
        new Set([
          "casework.calculations.adjustedIncome",
          "casework.calculations.householdTotal",
          "casework.calculations.eligibilityScore",
        ]),
      );
      const nodes = flattenNodes(definition.root);
      for (const code of WASM_CASEWORK_SAMPLE.expectedFacts.calculatedValues
        ? Object.keys(WASM_CASEWORK_SAMPLE.expectedFacts.calculatedValues)
        : []) {
        const id = definition.idByCode[code];
        expect(definition.staticReadOnlyById[id]).toBe(true);
        expect(nodes.find((node) => node.code === code)).toMatchObject({
          kind: "field",
          readOnly: true,
        });
      }

      const evaluation = await transport.evaluateRules(
        createEvaluateRulesRequest(compiled, definition, WASM_CASEWORK_SAMPLE.initialValues),
      );
      expect(evaluation.visibility).toMatchObject(
        WASM_CASEWORK_SAMPLE.expectedFacts.visibility ?? {},
      );
      expect(evaluation.enabled).toMatchObject(WASM_CASEWORK_SAMPLE.expectedFacts.enabled ?? {});
      expect(evaluation.required).toMatchObject(WASM_CASEWORK_SAMPLE.expectedFacts.required ?? {});
      expect(evaluation.calculatedValues).toEqual(
        WASM_CASEWORK_SAMPLE.expectedFacts.calculatedValues,
      );
      expect(evaluation.validationErrors).toEqual([]);

      const conditionalEvaluation = await transport.evaluateRules(
        createEvaluateRulesRequest(compiled, definition, {
          ...WASM_CASEWORK_SAMPLE.initialValues,
          "casework.status": "standard",
          "casework.context.contact.method": "email",
        }),
      );
      for (const map of [
        conditionalEvaluation.visibility,
        conditionalEvaluation.enabled,
        conditionalEvaluation.required,
      ]) {
        expect(map).toMatchObject({
          "casework-review-reason": false,
          "casework-contact-value": false,
        });
      }

      const completeRequest = createValidateResponseRequest(
        compiled,
        definition,
        WASM_CASEWORK_SAMPLE.initialValues,
        "Complete",
      );
      const submittedAnswers = JSON.parse(completeRequest.answersJson) as Record<string, unknown>;
      expect(submittedAnswers).toEqual(WASM_CASEWORK_SAMPLE.initialValues);
      for (const code of Object.keys(WASM_CASEWORK_SAMPLE.expectedFacts.calculatedValues ?? {})) {
        expect(submittedAnswers).not.toHaveProperty(code);
      }

      const complete = await transport.validateResponse(completeRequest);
      expect(complete.isValid).toBe(true);
      expect(complete.errors).toEqual([]);
      const normalized = JSON.parse(complete.normalizedAnswersJson) as Record<string, unknown>;
      expect(normalized).toMatchObject(WASM_CASEWORK_SAMPLE.expectedFacts.calculatedValues ?? {});
      expect(Object.values(normalized).some((value) => Array.isArray(value))).toBe(false);

      const missingReviewReason = { ...WASM_CASEWORK_SAMPLE.initialValues };
      delete missingReviewReason["casework.reviewReason"];
      const draft = await transport.validateResponse(
        createValidateResponseRequest(compiled, definition, missingReviewReason, "Draft"),
      );
      const completeMissingReviewReason = await transport.validateResponse(
        createValidateResponseRequest(compiled, definition, missingReviewReason, "Complete"),
      );
      expect(draft.isValid).toBe(true);
      expect(completeMissingReviewReason.isValid).toBe(false);
      const requiredError = completeMissingReviewReason.errors.find(
        (error) => error.code === "REQUIRED_FIELD_MISSING",
      );
      expect(requiredError).toBeDefined();
      if (requiredError === undefined) {
        throw new Error("expected the conditional required-field error");
      }
      expect(resolveFieldForPath(definition, requiredError.path)).toMatchObject({
        id: "casework-review-reason",
        code: "casework.reviewReason",
        kind: "field",
      });

      const hiddenReviewReason = await transport.validateResponse(
        createValidateResponseRequest(
          compiled,
          definition,
          {
            ...WASM_CASEWORK_SAMPLE.initialValues,
            "casework.status": "standard",
          },
          "Complete",
        ),
      );
      const hiddenError = hiddenReviewReason.errors.find(
        (error) => error.code === "HIDDEN_FIELD_VALUE",
      );
      expect(hiddenError).toBeDefined();
      if (hiddenError !== undefined) {
        expect(resolveFieldForPath(definition, hiddenError.path)).toMatchObject({
          id: "casework-review-reason",
          code: "casework.reviewReason",
          kind: "field",
        });
      }

      const highIncome = await transport.validateResponse(
        createValidateResponseRequest(
          compiled,
          definition,
          {
            ...WASM_CASEWORK_SAMPLE.initialValues,
            "casework.context.household.income": 1600,
          },
          "Complete",
        ),
      );
      expect(highIncome.isValid).toBe(false);
      expect(highIncome.errors.map((error) => error.code)).toContain(
        "CASEWORK_HIGH_INCOME_REQUIRES_REVIEW",
      );
      const customError = highIncome.errors.find(
        (error) => error.code === "CASEWORK_HIGH_INCOME_REQUIRES_REVIEW",
      );
      expect(customError).toBeDefined();
      if (customError !== undefined) {
        expect(resolveFieldForPath(definition, customError.path)).toMatchObject({
          kind: "rules",
          pointer: "/rules/validations",
        });
      }

      const largeHousehold = await transport.validateResponse(
        createValidateResponseRequest(
          compiled,
          definition,
          {
            ...WASM_CASEWORK_SAMPLE.initialValues,
            "casework.context.household.size": 5,
          },
          "Complete",
        ),
      );
      expect(largeHousehold.isValid).toBe(false);
      expect(largeHousehold.errors.map((error) => error.code)).toContain(
        "CASEWORK_LARGE_HOUSEHOLD_REQUIRES_REVIEW",
      );

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps the packed WASM asset available to the browser build boundary", async () => {
    const packageJson = JSON.parse(
      await readFile(
        new URL("../../node_modules/@ailura/colander/package.json", import.meta.url),
        "utf8",
      ),
    ) as { files?: string[] };
    const wasm = await stat(
      new URL("../../node_modules/@ailura/colander/wasm/colander.wasm", import.meta.url),
    );

    expect(packageJson.files).toContain("wasm");
    expect(wasm.isFile()).toBe(true);
    expect(wasm.size).toBeGreaterThan(0);
  });
});
