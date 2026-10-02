import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  COLANDER_ABI_VERSION,
  COLANDER_MAX_REQUEST_BYTES,
  ColanderError,
  ColanderTransportError,
  ColanderWebError,
  createWebColander,
} from "../src/index.js";
import type {
  CompileRequest,
  CompiledForm,
  ContentHashRequest,
  DescribeFormRequest,
  DescribedField,
  DescribedForm,
  EvaluateRulesRequest,
  FieldType,
  LoadedCore,
  NextVersionRequest,
  ResponseValidation,
  RuleEvaluation,
  SchemaCheck,
  SchemaResult,
  ValidateResponseRequest,
  ValidateSchemaRequest,
  VersionBump,
} from "../src/index.js";

const compiled: CompiledForm = {
    contentHash: "fixture-hash",
    dependencyMetadataJson: "{}",
    formSchemaJson: '{"fields":[]}',
    rulesSchemaJson: null,
    uiSchemaJson: null,
  },
  evaluation: RuleEvaluation = {
    calculatedValues: {},
    enabled: {},
    required: {},
    validationErrors: [],
    visibility: {},
  },
  response: ResponseValidation = {
    errors: [],
    isValid: true,
    normalizedAnswersJson: "{}",
  },
  schema: SchemaCheck = { valid: true };

function makeCore(overrides: Partial<LoadedCore> = {}): LoadedCore {
  return {
    abiVersion: 1,
    compile: vi.fn(() => compiled),
    contentHash: vi.fn(() => "fixture-hash"),
    describeForm: vi.fn(() => ({ contentHash: "fixture-hash", fields: [] })),
    evaluateRules: vi.fn(() => evaluation),
    nextVersion: vi.fn(() => "1.0.1"),
    validateResponse: vi.fn(() => response),
    validateSchema: vi.fn(() => schema),
    versionInfo: vi.fn(() => ({ abi: 1, name: "fixture", version: "0.0.0" })),
    ...overrides,
  };
}

async function captureError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to reject");
}

function expectWebError(error: unknown, kind: "unavailable" | "operation"): ColanderWebError {
  expect(error).toBeInstanceOf(ColanderWebError);
  expect((error as ColanderWebError).kind).toBe(kind);
  return error as ColanderWebError;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWebColander lifecycle", () => {
  it("shares one in-flight load across concurrent callers", async () => {
    const core = makeCore();
    let resolveCore: ((value: LoadedCore) => void) | undefined;
    const loadCore = vi.fn(
        async () =>
          new Promise<LoadedCore>((resolve) => {
            resolveCore = resolve;
          }),
      ),
      client = createWebColander({ loadCore }),
      request: ContentHashRequest = { formSchemaJson: compiled.formSchemaJson },
      first = client.getCore(),
      second = client.contentHash(request);
    await Promise.resolve();
    expect(loadCore).toHaveBeenCalledTimes(1);

    resolveCore?.(core);
    await expect(first).resolves.toEqual({
      abiVersion: 1,
      versionInfo: { abi: 1, name: "fixture", version: "0.0.0" },
    });
    await expect(second).resolves.toBe("fixture-hash");
    expect(loadCore).toHaveBeenCalledTimes(1);
  });

  it("clears a rejected load so a later call can retry", async () => {
    const loadFailure = new Error("WASM asset is unavailable"),
      loadCore = vi
        .fn<() => Promise<LoadedCore>>()
        .mockRejectedValueOnce(loadFailure)
        .mockResolvedValueOnce(makeCore()),
      client = createWebColander({ loadCore }),
      error = expectWebError(await captureError(client.getCore()), "unavailable");
    expect(error.cause).toBe(loadFailure);
    await expect(client.getCore()).resolves.toMatchObject({ abiVersion: 1 });
    expect(loadCore).toHaveBeenCalledTimes(2);
  });

  it("drops a panicked core without dropping a later recovered core", async () => {
    const trappedCore = makeCore({
        evaluateRules: vi.fn(() => {
          throw new ColanderError("panic", "simulated WebAssembly trap");
        }),
      }),
      recoveredCore = makeCore(),
      loadCore = vi
        .fn<() => Promise<LoadedCore>>()
        .mockResolvedValueOnce(trappedCore)
        .mockResolvedValueOnce(recoveredCore),
      client = createWebColander({ loadCore }),
      request: EvaluateRulesRequest = {
        formSchemaJson: '{"fields":[]}',
        rulesSchemaJson: '{"fields":{}}',
        values: {},
      },
      panic = await captureError(client.evaluateRules(request));
    expect(panic).toBeInstanceOf(ColanderError);
    expect((panic as ColanderError).kind).toBe("panic");
    await expect(client.evaluateRules(request)).resolves.toBe(evaluation);
    expect(loadCore).toHaveBeenCalledTimes(2);
  });

  it("forwards all six request objects unchanged and preserves results", async () => {
    const compile = vi.fn((_request: CompileRequest) => compiled),
      contentHash = vi.fn((_request: ContentHashRequest) => "hash-result"),
      evaluateRules = vi.fn((_request: EvaluateRulesRequest) => evaluation),
      validateResponse = vi.fn((_request: ValidateResponseRequest) => response),
      validateSchema = vi.fn((_request: ValidateSchemaRequest) => schema),
      nextVersion = vi.fn((_request?: NextVersionRequest) => "1.0.1"),
      core = makeCore({
        compile,
        contentHash,
        evaluateRules,
        nextVersion,
        validateResponse,
        validateSchema,
      }),
      client = createWebColander({ loadCore: async () => core }),
      compileRequest: CompileRequest = { formSchemaJson: '{"fields":[]}' },
      contentHashRequest: ContentHashRequest = { formSchemaJson: '{"fields":[]}' },
      evaluateRequest: EvaluateRulesRequest = {
        formSchemaJson: '{"fields":[]}',
        rulesSchemaJson: '{"fields":{}}',
        values: { value: "kept" },
      },
      responseRequest: ValidateResponseRequest = {
        answersJson: '{"value":"kept"}',
        formSchemaJson: '{"fields":[]}',
      },
      schemaRequest: ValidateSchemaRequest = { instanceJson: "{}", kind: "instance" },
      versionRequest: NextVersionRequest = { published: ["1.0.0"] },
      results = await Promise.all([
        client.compile(compileRequest),
        client.contentHash(contentHashRequest),
        client.evaluateRules(evaluateRequest),
        client.validateResponse(responseRequest),
        client.validateSchema(schemaRequest),
        client.nextVersion(versionRequest),
      ]);

    expect(results).toEqual([compiled, "hash-result", evaluation, response, schema, "1.0.1"]);
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

  it("preserves main errors and wraps generic load and operation failures", async () => {
    const loadCause = new Error("load failed"),
      operationCause = new Error("operation failed"),
      coreError = new ColanderError("validation", "invalid payload"),
      loadClient = createWebColander({
        loadCore: async () => {
          throw loadCause;
        },
      }),
      operationClient = createWebColander({
        loadCore: async () =>
          makeCore({
            compile: vi.fn(() => {
              throw operationCause;
            }),
            evaluateRules: vi.fn(() => {
              throw coreError;
            }),
          }),
      }),
      loadError = expectWebError(await captureError(loadClient.getCore()), "unavailable");
    expect(loadError.cause).toBe(loadCause);
    const operationError = expectWebError(
      await captureError(operationClient.compile({ formSchemaJson: "{}" })),
      "operation",
    );
    expect(operationError.cause).toBe(operationCause);
    const preservedError = await captureError(
      operationClient.evaluateRules({
        formSchemaJson: "{}",
        rulesSchemaJson: "{}",
      }),
    );
    expect(preservedError).toBe(coreError);
    expect((preservedError as ColanderError).kind).toBe("validation");
  });

  it("preserves neutral transport categories from a custom boundary", async () => {
    const networkError = new ColanderTransportError("network failed", { kind: "network" }),
      operationClient = createWebColander({
        loadCore: async () =>
          makeCore({
            compile: vi.fn(() => {
              throw networkError;
            }),
          }),
      }),
      error = await captureError(operationClient.compile({ formSchemaJson: "{}" }));
    expect(error).toBe(networkError);
    expect(error).toBeInstanceOf(ColanderTransportError);
    expect((error as ColanderTransportError).kind).toBe("network");
  });

  it("adapts structural core and neutral failures without collapsing their categories", async () => {
    const structuralValidation = { kind: "validation", message: "invalid structural payload" },
      structuralUnavailable = { kind: "unavailable", message: "structural unavailable" },
      validationClient = createWebColander({
        loadCore: async () =>
          makeCore({
            compile: vi.fn(() => {
              throw structuralValidation;
            }),
          }),
      }),
      unavailableClient = createWebColander({
        loadCore: async () => {
          throw structuralUnavailable;
        },
      }),
      validationError = await captureError(validationClient.compile({ formSchemaJson: "{}" }));
    expect(validationError).toBeInstanceOf(ColanderTransportError);
    expect(validationError).not.toBeInstanceOf(ColanderWebError);
    expect(validationError).toMatchObject({
      kind: "validation",
      message: structuralValidation.message,
    });

    const unavailableError = await captureError(unavailableClient.getCore());
    expect(unavailableError).toBeInstanceOf(ColanderTransportError);
    expect(unavailableError).not.toBeInstanceOf(ColanderWebError);
    expect(unavailableError).toMatchObject({
      kind: "unavailable",
      message: structuralUnavailable.message,
    });
  });

  it("invalidates the cached core for a structural neutral panic", async () => {
    const trappedCore = makeCore({
        evaluateRules: vi.fn(() => {
          throw { kind: "panic", message: "structural neutral panic" };
        }),
      }),
      recoveredCore = makeCore(),
      loadCore = vi
        .fn<() => Promise<LoadedCore>>()
        .mockResolvedValueOnce(trappedCore)
        .mockResolvedValueOnce(recoveredCore),
      client = createWebColander({ loadCore }),
      request: EvaluateRulesRequest = {
        formSchemaJson: '{"fields":[]}',
        rulesSchemaJson: '{"fields":{}}',
      },
      error = await captureError(client.evaluateRules(request));
    expect(error).toBeInstanceOf(ColanderTransportError);
    expect(error).toMatchObject({ kind: "panic", message: "structural neutral panic" });
    await expect(client.evaluateRules(request)).resolves.toBe(evaluation);
    expect(loadCore).toHaveBeenCalledTimes(2);
  });
});

describe("packed core integration", () => {
  it("uses the real packed core identity and compiles a real request in Node", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch"),
      client = createWebColander();

    try {
      await expect(client.getCore()).resolves.toMatchObject({
        abiVersion: 1,
        // The packed core's identity is asserted in packages/colander, against
        // The version its corpus lock declares. Repeating the literal here made
        // A repin fail in two places with no single owner.
        versionInfo: { abi: 1, name: "colander" },
      });
      const info = await client.getCore();
      expect(info.versionInfo.version).toMatch(/^\d+\.\d+\.\d+$/u);
      const result = await client.compile({ formSchemaJson: '{"fields":[]}' });
      expect(result.formSchemaJson).toContain('"fields":[]');
      expect(result.contentHash).toMatch(/^[0-9a-f]+$/u);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("package boundary", () => {
  it("depends on the core and neutral client contracts without a duplicate runtime implementation", async () => {
    const packageJson = JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
      ) as {
        name?: string;
        dependencies?: Record<string, string>;
        files?: string[];
        exports?: Record<string, { types?: string; import?: string }>;
      },
      clientSource = await readFile(new URL("../src/client.ts", import.meta.url), "utf8");

    expect(packageJson.name).toBe("@ailura/colander-browser");
    expect(packageJson.dependencies).toEqual({
      "@ailura/colander": "workspace:*",
      "@ailura/colander-client": "workspace:*",
    });
    expect(packageJson.files).toEqual(["dist", "README.md"]);
    expect(packageJson.exports?.["."]).toMatchObject({
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(clientSource).toMatch(/from ["']@ailura\/colander["']/u);
    expect(clientSource).toContain("@ailura/colander-client");
    expect(clientSource).not.toContain("WebAssembly");
    expect(clientSource).not.toContain("fetch(");
  });
});

describe("the surface this package re-exports", () => {
  it("names every core request and result type its operations return", async () => {
    expect.hasAssertions();
    // A consumer must be able to name what a call returns. The describe family was missing,
    // So `client.describeForm()` had a return type no import could reach. Every name below is
    // Checked as a type by `pnpm run typecheck` over this file, and the case ends with a real
    // Round trip so it is not a type-level assertion that never runs.
    const described: DescribedForm = {
        contentHash: "fixture-hash",
        fields: [
          {
            code: "body.weight.kg",
            id: "weight-kg",
            parentPath: null,
            path: "/fields/0",
            readOnly: false,
            required: true,
            type: "number",
          },
        ],
      },
      client = createWebColander({
        loadCore: async () => makeCore({ describeForm: vi.fn(() => described) }),
      });
    await expect(client.describeForm({ formSchemaJson: "{}" })).resolves.toStrictEqual(described);
    expectTypeOf<CompileRequest>().toBeObject();
    expectTypeOf<CompiledForm>().toBeObject();
    expectTypeOf<ContentHashRequest>().toBeObject();
    expectTypeOf<DescribeFormRequest>().toBeObject();
    expectTypeOf<DescribedField>().toBeObject();
    expectTypeOf<DescribedForm>().toBeObject();
    expectTypeOf<EvaluateRulesRequest>().toBeObject();
    expectTypeOf<"text">().toMatchTypeOf<FieldType>();
    expectTypeOf<"component-ref">().toMatchTypeOf<FieldType>();
    expectTypeOf<NextVersionRequest>().toBeObject();
    expectTypeOf<ResponseValidation>().toBeObject();
    expectTypeOf<RuleEvaluation>().toBeObject();
    expectTypeOf<SchemaCheck>().toBeObject();
    expectTypeOf<SchemaResult>().toBeObject();
    expectTypeOf<ValidateResponseRequest>().toBeObject();
    expectTypeOf<ValidateSchemaRequest>().toBeObject();
    expectTypeOf<"patch">().toMatchTypeOf<VersionBump>();
    expectTypeOf<"major">().toMatchTypeOf<VersionBump>();
  });

  it("re-exports the core constants a caller needs to reason about the boundary", () => {
    expect.hasAssertions();
    expect(COLANDER_ABI_VERSION).toBe(1);
    expect(COLANDER_MAX_REQUEST_BYTES).toBe(67_108_864);
  });

  it("passes a core failure through with its kind and its code", async () => {
    expect.hasAssertions();
    const core = makeCore({
        nextVersion: vi.fn(() => {
          throw new ColanderError("validation", "INVALID_SEMVER: invalid semantic version: 01.0.0");
        }),
      }),
      client = createWebColander({ loadCore: async () => core }),
      error = (await captureError(client.nextVersion({ published: ["01.0.0"] }))) as ColanderError;
    expect(error).toBeInstanceOf(ColanderError);
    expect(error.kind).toBe("validation");
    expect(error.code).toBe("INVALID_SEMVER");
  });
});
