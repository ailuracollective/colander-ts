import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ColanderApiError,
  httpColanderTransport,
  toColanderApiError,
} from "./http-colander-transport";

function mockResponse(body: string, status = 200): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("httpColanderTransport", () => {
  it("preserves JSON text fields in a valid compiled response", async () => {
    mockResponse(
      JSON.stringify({
        formSchemaJson: '{"fields":[]}',
        uiSchemaJson: null,
        rulesSchemaJson: null,
        dependencyMetadataJson: "{}",
        contentHash: "hash",
      }),
    );

    await expect(
      httpColanderTransport.compile({ formSchemaJson: '{"fields":[]}' }),
    ).resolves.toMatchObject({
      formSchemaJson: '{"fields":[]}',
      contentHash: "hash",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/forms/compile",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects malformed success bodies as operation failures", async () => {
    mockResponse('{"unexpected":true}');

    await expect(httpColanderTransport.compile({ formSchemaJson: "{}" })).rejects.toMatchObject({
      name: "ColanderApiError",
      kind: "operation",
    });
  });

  it("rejects non-JSON success responses as operation failures", async () => {
    mockResponse("not json");

    await expect(httpColanderTransport.getCore()).rejects.toMatchObject({
      name: "ColanderApiError",
      kind: "operation",
    });
  });

  it("preserves a core category from a 4xx response", async () => {
    mockResponse(JSON.stringify({ kind: "validation", message: "invalid form" }), 422);

    await expect(
      httpColanderTransport.validateSchema({ kind: "instance", instanceJson: "{}" }),
    ).rejects.toMatchObject({
      kind: "validation",
      message: "invalid form",
      status: 422,
    });
  });

  it.each(["invalid_request", "unavailable", "network", "operation", "unknown"] as const)(
    "preserves the neutral %s category from a response body",
    async (kind) => {
      mockResponse(
        JSON.stringify({ kind, message: `${kind} failure`, detail: "upstream detail" }),
        503,
      );

      await expect(httpColanderTransport.getCore()).rejects.toMatchObject({
        kind,
        message: `${kind} failure`,
        detail: "upstream detail",
        status: 503,
      });
    },
  );

  it("rejects a malformed neutral error body instead of trusting its kind", async () => {
    mockResponse(JSON.stringify({ kind: "network", message: "failed", detail: 42 }), 503);

    await expect(httpColanderTransport.getCore()).rejects.toMatchObject({
      kind: "operation",
      message: "Request failed with HTTP 503.",
      status: 503,
    });
  });

  it("classifies an untyped 4xx response as an invalid request", async () => {
    mockResponse("bad request", 400);

    await expect(httpColanderTransport.nextVersion()).rejects.toMatchObject({
      kind: "invalid_request",
      status: 400,
    });
  });

  it("preserves a core panic from a 5xx response and types an untyped 5xx as operation", async () => {
    mockResponse(JSON.stringify({ kind: "panic", message: "core trapped" }), 503);
    await expect(httpColanderTransport.getCore()).rejects.toMatchObject({
      kind: "panic",
      status: 503,
    });

    mockResponse("server failure", 500);
    await expect(httpColanderTransport.getCore()).rejects.toMatchObject({
      kind: "operation",
      status: 500,
    });
  });

  it("keeps fetch failures in the network category", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(httpColanderTransport.getCore()).rejects.toMatchObject({
      name: "ColanderApiError",
      kind: "network",
    });
  });

  it("normalizes an existing neutral error without changing its kind", () => {
    const error = toColanderApiError(Object.assign(new Error("upstream"), { kind: "operation" }));

    expect(error).toBeInstanceOf(ColanderApiError);
    expect(error.kind).toBe("operation");
  });
});
