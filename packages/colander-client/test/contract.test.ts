import { describe, expect, it } from "vitest";

import {
  ColanderTransportError,
  isColanderSourceErrorKind,
  isColanderTransportErrorKind,
  toColanderTransportError,
} from "../src/index.js";
import type {
  ColanderEvent,
  ColanderEventListener,
  ColanderEventSource,
  ColanderTransport,
  CompileRequest,
  CompiledForm,
  ContentHashRequest,
  CoreInfo,
  DescribeFormRequest,
  DescribedForm,
  EvaluateRulesRequest,
  NextVersionRequest,
  ResponseValidation,
  RuleEvaluation,
  SchemaCheck,
  ValidateResponseRequest,
  ValidateSchemaRequest,
} from "../src/index.js";

const coreInfo: CoreInfo = {
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
  ruleEvaluation: RuleEvaluation = {
    calculatedValues: { total: 3 },
    enabled: { field: true },
    required: { field: false },
    validationErrors: [],
    visibility: { field: true },
  },
  responseValidation: ResponseValidation = {
    errors: [],
    isValid: true,
    normalizedAnswersJson: '{"value":3}',
  },
  schemaCheck: SchemaCheck = { valid: true },
  fakeTransport: ColanderTransport = {
    async compile(_request: CompileRequest): Promise<CompiledForm> {
      return compiledForm;
    },
    async contentHash(_request: ContentHashRequest): Promise<string> {
      return compiledForm.contentHash;
    },
    async describeForm(_request: DescribeFormRequest): Promise<DescribedForm> {
      return { contentHash: compiledForm.contentHash, fields: [] };
    },
    async evaluateRules(_request: EvaluateRulesRequest): Promise<RuleEvaluation> {
      return ruleEvaluation;
    },
    async getCore(): Promise<CoreInfo> {
      return coreInfo;
    },
    async nextVersion(_request?: NextVersionRequest): Promise<string> {
      return "0.1.1";
    },
    async validateResponse(_request: ValidateResponseRequest): Promise<ResponseValidation> {
      return responseValidation;
    },
    async validateSchema(_request: ValidateSchemaRequest): Promise<SchemaCheck> {
      return schemaCheck;
    },
  };

class FakeEventSource implements ColanderEventSource {
  private readonly listeners = new Set<ColanderEventListener>();

  subscribe(listener: ColanderEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: ColanderEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe("source-neutral contracts", () => {
  it("accepts a fake transport and exposes every operation", async () => {
    await expect(fakeTransport.getCore()).resolves.toEqual(coreInfo);
    await expect(fakeTransport.compile({ formSchemaJson: '{"fields":[]}' })).resolves.toEqual(
      compiledForm,
    );
    await expect(fakeTransport.contentHash({ formSchemaJson: '{"fields":[]}' })).resolves.toBe(
      "abc123",
    );
    await expect(
      fakeTransport.evaluateRules({
        formSchemaJson: '{"fields":[]}',
        rulesSchemaJson: "{}",
        values: { value: 1 },
      }),
    ).resolves.toEqual(ruleEvaluation);
    await expect(
      fakeTransport.validateResponse({
        answersJson: '{"value":3}',
        formSchemaJson: '{"fields":[]}',
      }),
    ).resolves.toEqual(responseValidation);
    await expect(fakeTransport.validateSchema({ kind: "form" })).resolves.toEqual(schemaCheck);
    await expect(fakeTransport.nextVersion({ published: ["0.1.0"] })).resolves.toBe("0.1.1");
  });

  it("supports a source-neutral event subscription", () => {
    const source = new FakeEventSource(),
      received: ColanderEvent[] = [],
      unsubscribe = source.subscribe((event) => received.push(event));

    source.emit({ payload: { contentHash: "abc123" }, type: "form.compiled" });
    unsubscribe();
    source.emit({ payload: {}, type: "form.changed" });

    expect(received).toEqual([{ payload: { contentHash: "abc123" }, type: "form.compiled" }]);
  });

  it("keeps the source failure categories explicit", () => {
    expect(isColanderSourceErrorKind("unavailable")).toBe(true);
    expect(isColanderSourceErrorKind("network")).toBe(true);
    expect(isColanderSourceErrorKind("operation")).toBe(true);
    expect(isColanderSourceErrorKind("unknown")).toBe(true);
    expect(isColanderSourceErrorKind("validation")).toBe(false);
  });

  it("recognises a core category structurally, without restating the ABI list", () => {
    // A category the core could add later is still accepted, because the check
    // Is structural. Only a non-string is rejected.
    expect(isColanderTransportErrorKind("network")).toBe(true);
    expect(isColanderTransportErrorKind("validation")).toBe(true);
    expect(isColanderTransportErrorKind("a_category_from_a_newer_core")).toBe(true);
    expect(isColanderTransportErrorKind("")).toBe(false);
    expect(isColanderTransportErrorKind(42)).toBe(false);
    expect(isColanderTransportErrorKind(null)).toBe(false);
  });

  it("adapts a structurally compatible core error without collapsing its kind", () => {
    const adapted = toColanderTransportError({
      detail: "wasm",
      kind: "panic",
      message: "core trapped",
    });

    expect(adapted).toBeInstanceOf(ColanderTransportError);
    expect(adapted.kind).toBe("panic");
    expect(adapted.detail).toBe("wasm");
  });

  it("exports the neutral error as a runtime value", () => {
    const cause = new Error("underlying failure"),
      error = new ColanderTransportError("operation failed", {
        cause,
        detail: "the operation could not be completed",
        kind: "operation",
      });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ColanderTransportError");
    expect(error.message).toBe("operation failed");
    expect(error.kind).toBe("operation");
    expect(error.detail).toBe("the operation could not be completed");
    expect(error.cause).toBe(cause);
  });

  it("exposes the neutral error and headless form-model helpers", async () => {
    const surface = await import("../src/index.js");

    expect(surface.ColanderTransportError).toBeDefined();
    expect(surface.createFormDefinitionFromDescribed).toBeTypeOf("function");
    expect(surface.createFormDefinitionFromCompiled).toBeTypeOf("function");
    expect(surface.createCompileRequest).toBeTypeOf("function");
    expect(surface.createValidateResponseRequest).toBeTypeOf("function");
    expect(surface.createEvaluateRulesRequest).toBeTypeOf("function");
    expect(surface.resolveFieldForPath).toBeTypeOf("function");
    expect(surface.createEvaluateRulesRequest).toBeTypeOf("function");
    expect(surface.applyEvaluation).toBeTypeOf("function");
    expect(surface.createRuleState).toBeTypeOf("function");
  });
});
