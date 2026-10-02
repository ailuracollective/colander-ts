import {
  createFormDefinitionFromCompiled,
  type FormDefinition,
  type FormNode,
} from "@ailura/colander-client";
import { describe, expect, it } from "vitest";

import { createWasmColanderTransport } from "./lib/wasm-colander-transport";
import {
  ACCESS_SAMPLE,
  CASEWORK_SAMPLE,
  COMPONENT_SAMPLE,
  DEFAULT_SAMPLE_ID,
  SAMPLES,
  WASM_CASEWORK_SAMPLE,
  createSampleCompileRequest,
  findSample,
  findSampleOrUndefined,
} from "./samples";

function flatten(nodes: readonly FormNode[]): FormNode[] {
  return nodes.flatMap((node) =>
    node.kind === "field" ? [node] : [node, ...flatten(node.children)],
  );
}

function collectRawFields(fields: readonly unknown[]): Array<Record<string, unknown>> {
  const collected: Array<Record<string, unknown>> = [];
  for (const field of fields) {
    if (typeof field !== "object" || field === null || Array.isArray(field)) {
      continue;
    }
    const record = field as Record<string, unknown>;
    collected.push(record);
    if (Array.isArray(record.items)) {
      collected.push(...collectRawFields(record.items));
    }
  }
  return collected;
}

/**
 * These are pure document fixtures, so the definition is built from the real
 * core describing a real compilation of them. Nothing about a sample is
 * asserted through a stand-in.
 */
async function definitionFor(sample: {
  form: unknown;
  ui?: unknown;
  rules?: unknown;
  components?: unknown;
}): Promise<FormDefinition> {
  const transport = createWasmColanderTransport();
  const request = createSampleCompileRequest(sample as never);
  const compiled = await transport.compile(request);
  return createFormDefinitionFromCompiled(compiled, await transport.describeForm(request));
}

describe("React sample catalog", () => {
  it("keeps sample ids and execution sources unique and explicit", () => {
    const ids = SAMPLES.map((sample) => sample.id);
    const sources = SAMPLES.map((sample) => sample.execution);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(sources)).toEqual(new Set(["http", "wasm"]));
    expect(sources.filter((source) => source === "wasm").length).toBeGreaterThanOrEqual(2);
    expect(SAMPLES.some((sample) => sample.id === "dynamic-household")).toBe(true);
    expect(SAMPLES.some((sample) => sample.id === "access-matrix")).toBe(true);
    expect(SAMPLES.some((sample) => sample.id === "component-address")).toBe(true);
    expect(SAMPLES.some((sample) => sample.id === "casework-intake")).toBe(true);
    expect(SAMPLES.some((sample) => sample.id === "wasm-casework-intake")).toBe(true);
    expect(DEFAULT_SAMPLE_ID).toBe("bmi");
  });

  it("resolves every known id strictly while findSample still falls back", () => {
    for (const sample of SAMPLES) {
      expect(findSampleOrUndefined(sample.id)?.id).toBe(sample.id);
    }

    // The routing lookup must be able to say "unknown" where the UI lookup
    // substitutes the default sample, so a mistyped URL is never hidden.
    expect(findSampleOrUndefined("definitely-not-a-sample")).toBeUndefined();
    expect(findSample("definitely-not-a-sample")).toBe(findSample(DEFAULT_SAMPLE_ID));
  });

  it("serializes object documents only at the request boundary", () => {
    for (const sample of SAMPLES) {
      const request = createSampleCompileRequest(sample);
      expect(typeof request.formSchemaJson).toBe("string");
      expect(typeof request.rulesSchemaJson).toBe("string");
      expect(request.formSchemaJson).toBe(JSON.stringify(sample.form));
      expect(request.rulesSchemaJson).toBe(JSON.stringify(sample.rules));
      if (sample.components === undefined) {
        expect(request).not.toHaveProperty("components");
      } else {
        expect(request.components).toStrictEqual(sample.components);
      }
    }
  });

  it("shares one scalar casework document set across explicit sources", () => {
    expect(CASEWORK_SAMPLE.execution).toBe("http");
    expect(WASM_CASEWORK_SAMPLE.execution).toBe("wasm");
    expect(WASM_CASEWORK_SAMPLE.form).toBe(CASEWORK_SAMPLE.form);
    expect(WASM_CASEWORK_SAMPLE.rules).toBe(CASEWORK_SAMPLE.rules);
    expect(WASM_CASEWORK_SAMPLE.ui).toBe(CASEWORK_SAMPLE.ui);
    expect(WASM_CASEWORK_SAMPLE.components).toBe(CASEWORK_SAMPLE.components);
    expect(WASM_CASEWORK_SAMPLE.initialValues).toBe(CASEWORK_SAMPLE.initialValues);
    expect(WASM_CASEWORK_SAMPLE.expectedFacts).toBe(CASEWORK_SAMPLE.expectedFacts);

    const request = createSampleCompileRequest(CASEWORK_SAMPLE);
    expect(typeof request.uiSchemaJson).toBe("string");
    expect(request.uiSchemaJson).toBe(JSON.stringify(CASEWORK_SAMPLE.ui));
    const form = JSON.parse(request.formSchemaJson) as {
      fields: Array<{ items?: Array<Record<string, unknown>> }>;
    };
    const component = JSON.parse(request.components?.[0]?.formSchemaJson ?? "{}") as {
      fields?: unknown[];
    };
    const rawFields = [
      ...collectRawFields(CASEWORK_SAMPLE.form.fields ?? []),
      ...collectRawFields(component.fields ?? []),
    ];
    const ids = rawFields
      .map((field) => field.id)
      .filter((id): id is string => typeof id === "string");
    const codes = rawFields
      .map((field) => field.code)
      .filter((code): code is string => typeof code === "string");

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(codes).size).toBe(codes.length);
    expect(rawFields.some((field) => field.type === "repeater")).toBe(false);
    expect(rawFields.some((field) => field.allowMultiple === true)).toBe(false);
    expect(Object.values(CASEWORK_SAMPLE.initialValues).some((value) => Array.isArray(value))).toBe(
      false,
    );
    expect(form.fields[0]?.items?.[1]).toMatchObject({
      type: "component-ref",
      componentCode: "casework-context",
      componentVersion: "1.0.0",
    });
    expect(rawFields.find((field) => field.code === "casework.context.contact")).toMatchObject({
      type: "group",
    });
  });

  it("models groups flat and repeaters as arrays of row objects", async () => {
    const definition = await definitionFor(ACCESS_SAMPLE);
    const nodes = flatten(definition.root);
    const group = nodes.find((node) => node.code === "access");
    const repeater = nodes.find((node) => node.code === "access.members");
    const multiSelect = nodes.find((node) => node.code === "access.regions");

    expect(group?.kind).toBe("group");
    expect(repeater?.kind).toBe("repeater");
    expect(multiSelect?.kind).toBe("field");
    // Multi-value and row shapes are the core's business now, so the declared
    // flags are read off the field rather than through a derived index.
    expect(multiSelect?.field?.allowMultiple).toBe(true);
    expect(multiSelect?.type).toBe("choice");
    if (repeater?.kind !== "repeater") {
      throw new Error("expected a repeater node");
    }
    expect(repeater.children.map((child) => child.code)).toEqual([
      "access.members.name",
      "access.members.role",
    ]);
    expect(ACCESS_SAMPLE.initialValues["access.members"]).toEqual([
      {
        "access.members.name": "Ada Lovelace",
        "access.members.role": "owner",
      },
      {
        "access.members.name": "Grace Hopper",
        "access.members.role": "reviewer",
      },
    ]);
  });

  it("supplies component references without asking the generic helper to resolve them", () => {
    const request = createSampleCompileRequest(COMPONENT_SAMPLE);
    const form = JSON.parse(request.formSchemaJson) as {
      fields: Array<Record<string, unknown>>;
    };
    const componentField = form.fields[0];

    expect(componentField).toMatchObject({
      type: "component-ref",
      componentCode: "address-card",
      componentVersion: "1.0.0",
    });
    expect(request.components).toHaveLength(1);
    expect(request.components?.[0]).toMatchObject({
      code: "address-card",
      version: "1.0.0",
    });
    expect(typeof request.components?.[0].formSchemaJson).toBe("string");
  });

  it("exposes stable expected facts instead of error-message assertions", () => {
    for (const sample of SAMPLES) {
      expect(sample.expectedFacts).toBeTypeOf("object");
      expect(sample.expected.length).toBeGreaterThan(0);
    }
    expect(SAMPLES.find((sample) => sample.id === "bp")?.expectedFacts.validation).toEqual({
      isValid: false,
      errorCodes: ["BP_SYSTOLIC_GT_DIASTOLIC"],
      normalizedAnswers: {
        "vital.bp.systolic": 120,
        "vital.bp.diastolic": 130,
      },
    });
    expect(CASEWORK_SAMPLE.expectedFacts.validation).toEqual({
      isValid: true,
      errorCodes: [],
    });
  });
});
