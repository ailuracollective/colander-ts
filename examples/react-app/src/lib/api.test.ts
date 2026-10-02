import type { ColanderTransport } from "@ailura/colander-client";
import { describe, expect, it, vi } from "vitest";

import { createColanderApi } from "./api";

function makeTransport(): ColanderTransport {
  return {
    getCore: vi.fn(async () => ({
      abiVersion: 1,
      versionInfo: { name: "selected", version: "1", abi: 1 },
    })),
    compile: vi.fn(async () => ({
      formSchemaJson: "{}",
      uiSchemaJson: null,
      rulesSchemaJson: null,
      dependencyMetadataJson: "{}",
      contentHash: "hash",
    })),
    describeForm: vi.fn(async () => ({ fields: [], contentHash: "hash" })),
    contentHash: vi.fn(async () => "hash"),
    evaluateRules: vi.fn(async () => ({
      visibility: {},
      enabled: {},
      required: {},
      calculatedValues: {},
      validationErrors: [],
    })),
    validateResponse: vi.fn(async () => ({
      normalizedAnswersJson: "{}",
      errors: [],
      isValid: true,
    })),
    validateSchema: vi.fn(async () => ({ valid: true }) as const),
    nextVersion: vi.fn(async () => "1.0.1"),
  };
}

describe("createColanderApi", () => {
  it("injects one selected transport without consulting another source", async () => {
    const selected = makeTransport();
    const other = makeTransport();
    const api = createColanderApi(selected);
    const request = { formSchemaJson: '{"fields":[]}' };

    await api.compile(request);
    await api.getCore();

    expect(selected.compile).toHaveBeenCalledWith(request);
    expect(selected.getCore).toHaveBeenCalledTimes(1);
    expect(other.compile).not.toHaveBeenCalled();
    expect(other.getCore).not.toHaveBeenCalled();
  });
});
