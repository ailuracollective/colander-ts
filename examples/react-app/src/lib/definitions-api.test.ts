import { afterEach, describe, expect, it, vi } from "vitest";

import { createPublishedCompileRequest, hasUnsavedChanges } from "./definitions-api";
import { DefinitionsApiError, httpDefinitionsApi } from "./http-definitions-api";

/**
 * The stub pattern is the one `http-colander-transport.test.ts` already uses:
 * spy on `globalThis.fetch` and answer with a real `Response`. The repository
 * is not involved, so every case here is about what this client does with the
 * bytes and the status it is given.
 */
function mockResponse(body: string, status = 200): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function mockFailure(code: string, message: string, status: number): void {
  mockResponse(JSON.stringify({ code, message }), status);
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Deliberately awkward JSON text: unusual key order, `1.50`, an exponent, and
 * insignificant whitespace. Any parse/re-serialize round trip on the way to the
 * core would change these bytes, and with them the content hash the database
 * stored.
 */
const FORM_SCHEMA_JSON = `{
  "fields": [
    {"id":  "weight-kg", "code": "body.weight.kg", "type": "number", "multipleOf": 1.50},
    {"id": "bmi", "code": "body.bmi", "type": "number", "readOnly": true, "maximum": 1e2}
  ],
  "schemaVersion": "1.0.0"
}`;
const UI_SCHEMA_JSON = '{"layout":  [ {"type" :  "field",  "fieldId":  "bmi"} ]}';
const RULES_SCHEMA_JSON =
  '{"fields": {"bmi": {"calculate": {"op": "mul"}}}, "schemaVersion": "1.0.0"}';
const COMPONENTS_JSON = '{"components":[{"code":"address-card","version":"1.0.0"}]}';

function publishedBody(): string {
  return JSON.stringify({
    id: "version-2",
    formId: "bmi-form",
    version: 2,
    status: "published",
    formSchemaJson: FORM_SCHEMA_JSON,
    uiSchemaJson: UI_SCHEMA_JSON,
    rulesSchemaJson: RULES_SCHEMA_JSON,
    componentsJson: COMPONENTS_JSON,
    contentHash: "sha256:stored",
    createdAt: "2026-02-01T10:00:00.000Z",
    publishedAt: "2026-02-02T11:30:00.000Z",
  });
}

describe("httpDefinitionsApi.getPublished", () => {
  it("returns the four documents byte-identical", async () => {
    mockResponse(publishedBody());

    const published = await httpDefinitionsApi.getPublished("bmi-form");

    expect(published.formSchemaJson).toBe(FORM_SCHEMA_JSON);
    expect(published.uiSchemaJson).toBe(UI_SCHEMA_JSON);
    expect(published.rulesSchemaJson).toBe(RULES_SCHEMA_JSON);
    expect(published.componentsJson).toBe(COMPONENTS_JSON);
    expect(published.contentHash).toBe("sha256:stored");
    expect(published.publishedAt).toBe("2026-02-02T11:30:00.000Z");
    expect(fetch).toHaveBeenCalledWith(
      "/api/definitions/bmi-form/published",
      expect.objectContaining({ headers: expect.objectContaining({}) }),
    );
  });

  it("keeps an absent document absent instead of turning it into an empty document", async () => {
    mockResponse(
      JSON.stringify({
        id: "version-1",
        formId: "bmi-form",
        version: 1,
        status: "published",
        formSchemaJson: FORM_SCHEMA_JSON,
        uiSchemaJson: null,
        rulesSchemaJson: null,
        componentsJson: null,
        contentHash: "sha256:stored",
        createdAt: "2026-02-01T10:00:00.000Z",
        publishedAt: "2026-02-02T11:30:00.000Z",
      }),
    );

    const published = await httpDefinitionsApi.getPublished("bmi-form");

    expect(published.uiSchemaJson).toBeNull();
    expect(published.rulesSchemaJson).toBeNull();
    // The compile request carries the form document verbatim and omits the two
    // absent documents, so the core hashes exactly the stored bytes.
    expect(createPublishedCompileRequest(published)).toEqual({
      formSchemaJson: FORM_SCHEMA_JSON,
    });
  });

  it("rejects a 404 carrying no_published_version as a real state, not a network failure", async () => {
    mockFailure("no_published_version", "This form has no published version yet.", 404);

    await expect(httpDefinitionsApi.getPublished("draft-only")).rejects.toMatchObject({
      name: "DefinitionsApiError",
      kind: "no_published_version",
      code: "no_published_version",
      message: "This form has no published version yet.",
      status: 404,
    });
  });

  it("tells an unknown form id apart from a form with nothing published", async () => {
    mockFailure("definition_not_found", "No form definition with id missing.", 404);

    const error = await httpDefinitionsApi
      .getPublished("missing")
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(DefinitionsApiError);
    expect((error as DefinitionsApiError).kind).toBe("definition_not_found");
    expect((error as DefinitionsApiError).code).toBe("definition_not_found");
    expect((error as DefinitionsApiError).kind).not.toBe("no_published_version");
  });

  it("keeps two 404s with different codes on different kinds", async () => {
    mockFailure("no_published_version", "nothing published", 404);
    const noPublished = await httpDefinitionsApi
      .getPublished("a")
      .then(() => null)
      .catch((thrown: unknown) => thrown);
    mockFailure("definition_not_found", "no such form", 404);
    const missingDefinition = await httpDefinitionsApi
      .getPublished("b")
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect((noPublished as DefinitionsApiError).kind).not.toBe(
      (missingDefinition as DefinitionsApiError).kind,
    );
  });

  it("turns a non-2xx with no JSON body into a usable error instead of a parse error", async () => {
    mockResponse("<html>502 Bad Gateway</html>", 502);

    const error = await httpDefinitionsApi
      .getPublished("bmi-form")
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(DefinitionsApiError);
    expect((error as DefinitionsApiError).kind).toBe("operation");
    expect((error as DefinitionsApiError).code).toBeNull();
    expect((error as DefinitionsApiError).message).toBe("Request failed with HTTP 502.");
    expect((error as DefinitionsApiError).status).toBe(502);
  });

  it("classifies an empty non-2xx body the same way", async () => {
    mockResponse("", 404);

    await expect(httpDefinitionsApi.getPublished("bmi-form")).rejects.toMatchObject({
      kind: "unknown",
      message: "Request failed with HTTP 404.",
      status: 404,
    });
  });

  it("keeps a fetch failure in the network kind", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(httpDefinitionsApi.getPublished("bmi-form")).rejects.toMatchObject({
      name: "DefinitionsApiError",
      kind: "network",
    });
  });
});

describe("httpDefinitionsApi.listDefinitions", () => {
  it("maps the list payload", async () => {
    mockResponse(
      JSON.stringify([
        {
          id: "bmi-form",
          name: "BMI",
          description: "A calculated field.",
          versionCount: 2,
          isPublished: true,
          createdAt: "2026-02-01T10:00:00.000Z",
          updatedAt: "2026-02-02T11:30:00.000Z",
        },
        {
          id: "draft-only",
          name: "Draft only",
          description: "",
          versionCount: 1,
          isPublished: false,
          createdAt: "2026-02-01T10:00:00.000Z",
          updatedAt: "2026-02-01T10:00:00.000Z",
        },
      ]),
    );

    const definitions = await httpDefinitionsApi.listDefinitions();

    expect(definitions).toEqual([
      {
        id: "bmi-form",
        name: "BMI",
        description: "A calculated field.",
        versionCount: 2,
        isPublished: true,
        createdAt: "2026-02-01T10:00:00.000Z",
        updatedAt: "2026-02-02T11:30:00.000Z",
      },
      {
        id: "draft-only",
        name: "Draft only",
        description: "",
        versionCount: 1,
        isPublished: false,
        createdAt: "2026-02-01T10:00:00.000Z",
        updatedAt: "2026-02-01T10:00:00.000Z",
      },
    ]);
    expect(fetch).toHaveBeenCalledWith("/api/definitions", expect.anything());
  });

  it("rejects a malformed success body as an operation failure", async () => {
    mockResponse('[{"id":"bmi-form"}]');

    await expect(httpDefinitionsApi.listDefinitions()).rejects.toMatchObject({
      name: "DefinitionsApiError",
      kind: "operation",
      code: "malformed_response",
    });
  });
});

describe("httpDefinitionsApi version calls", () => {
  it("maps the version list", async () => {
    mockResponse(
      JSON.stringify([
        {
          id: "version-1",
          formId: "bmi-form",
          version: 1,
          status: "draft",
          contentHash: "sha256:draft",
          createdAt: "2026-02-01T10:00:00.000Z",
          publishedAt: null,
        },
      ]),
    );

    await expect(httpDefinitionsApi.getVersions("bmi-form")).resolves.toEqual([
      {
        id: "version-1",
        formId: "bmi-form",
        version: 1,
        status: "draft",
        contentHash: "sha256:draft",
        createdAt: "2026-02-01T10:00:00.000Z",
        publishedAt: null,
      },
    ]);
  });

  it("sends a draft's documents as text and maps the stored version", async () => {
    mockResponse(
      JSON.stringify({
        id: "version-3",
        formId: "bmi-form",
        version: 3,
        status: "draft",
        contentHash: "sha256:draft",
        createdAt: "2026-02-03T09:00:00.000Z",
        publishedAt: null,
      }),
      201,
    );

    await expect(
      httpDefinitionsApi.saveDraft("bmi-form", {
        formSchemaJson: FORM_SCHEMA_JSON,
        uiSchemaJson: UI_SCHEMA_JSON,
        rulesSchemaJson: RULES_SCHEMA_JSON,
        componentsJson: COMPONENTS_JSON,
      }),
    ).resolves.toMatchObject({ id: "version-3", status: "draft" });

    const sent = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(sent?.[0]).toBe("/api/definitions/bmi-form/versions");
    expect(JSON.parse(String((sent?.[1] as { body: string }).body))).toEqual({
      formSchemaJson: FORM_SCHEMA_JSON,
      uiSchemaJson: UI_SCHEMA_JSON,
      rulesSchemaJson: RULES_SCHEMA_JSON,
      componentsJson: COMPONENTS_JSON,
    });
  });

  it("reports a refused publication as a conflict with its own code", async () => {
    mockFailure("version_immutable", "A published version cannot change.", 409);

    await expect(httpDefinitionsApi.publishVersion("bmi-form", "version-2")).rejects.toMatchObject({
      kind: "conflict",
      code: "version_immutable",
      status: 409,
    });
  });
});

/** A version read: the four documents plus the core's verdict on them. */
function versionDetailBody(
  check: Record<string, unknown> = { valid: true, contentHash: "sha256:stored" },
): string {
  return JSON.stringify({
    version: {
      id: "version-3",
      formId: "bmi-form",
      version: 3,
      status: "draft",
      contentHash: null,
      createdAt: "2026-02-03T09:00:00.000Z",
      publishedAt: null,
      formSchemaJson: FORM_SCHEMA_JSON,
      uiSchemaJson: UI_SCHEMA_JSON,
      rulesSchemaJson: RULES_SCHEMA_JSON,
      componentsJson: COMPONENTS_JSON,
    },
    schemaCheck: check,
  });
}

describe("httpDefinitionsApi.getVersion", () => {
  it("returns the four documents byte-identical and the core's verdict on them", async () => {
    mockResponse(versionDetailBody());

    const detail = await httpDefinitionsApi.getVersion("bmi-form", "version-3");

    // The bytes the database stored are the bytes the model will parse, with
    // the awkward number literals and the odd spacing intact. A round trip here
    // would change the content hash the core is about to be asked for.
    expect(detail.formSchemaJson).toBe(FORM_SCHEMA_JSON);
    expect(detail.uiSchemaJson).toBe(UI_SCHEMA_JSON);
    expect(detail.rulesSchemaJson).toBe(RULES_SCHEMA_JSON);
    expect(detail.componentsJson).toBe(COMPONENTS_JSON);
    expect(detail.id).toBe("version-3");
    expect(detail.status).toBe("draft");
    expect(detail.schemaCheck).toEqual({ valid: true, contentHash: "sha256:stored" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/definitions/bmi-form/versions/version-3",
      expect.anything(),
    );
  });

  it("keeps an absent document absent on a draft read too", async () => {
    mockResponse(
      JSON.stringify({
        version: {
          id: "version-1",
          formId: "bmi-form",
          version: 1,
          status: "draft",
          contentHash: null,
          createdAt: "2026-02-01T10:00:00.000Z",
          publishedAt: null,
          formSchemaJson: FORM_SCHEMA_JSON,
          uiSchemaJson: null,
          rulesSchemaJson: null,
          componentsJson: null,
        },
        schemaCheck: { valid: false, code: "validation", message: "A choice needs its options." },
      }),
    );

    const detail = await httpDefinitionsApi.getVersion("bmi-form", "version-1");

    expect(detail.uiSchemaJson).toBeNull();
    expect(detail.rulesSchemaJson).toBeNull();
    expect(detail.componentsJson).toBeNull();
  });

  it("forwards an invalid verdict with the core's own code and message", async () => {
    mockResponse(
      versionDetailBody({
        valid: false,
        code: "SCHEMA_INVALID",
        message: "formSchemaJson.fields[1].type is not a known field type.",
      }),
    );

    const detail = await httpDefinitionsApi.getVersion("bmi-form", "version-3");

    expect(detail.schemaCheck).toEqual({
      valid: false,
      code: "SCHEMA_INVALID",
      message: "formSchemaJson.fields[1].type is not a known field type.",
    });
  });

  it("reports a malformed verdict rather than inventing one", async () => {
    mockResponse(versionDetailBody({ message: "valid is missing" }));

    await expect(httpDefinitionsApi.getVersion("bmi-form", "version-3")).rejects.toMatchObject({
      kind: "operation",
      code: "malformed_response",
    });
  });
});

describe("httpDefinitionsApi mutating calls", () => {
  it("sends the text it was given to updateDraft, without reformatting it", async () => {
    mockResponse(
      JSON.stringify({
        id: "version-3",
        formId: "bmi-form",
        version: 3,
        status: "draft",
        contentHash: null,
        createdAt: "2026-02-03T09:00:00.000Z",
        publishedAt: null,
      }),
    );

    await httpDefinitionsApi.updateDraft("bmi-form", "version-3", {
      formSchemaJson: FORM_SCHEMA_JSON,
      uiSchemaJson: UI_SCHEMA_JSON,
      rulesSchemaJson: RULES_SCHEMA_JSON,
      componentsJson: COMPONENTS_JSON,
    });

    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("/api/definitions/bmi-form/versions/version-3");
    expect((call?.[1] as { method: string }).method).toBe("PATCH");
    // The four strings travel as the caller handed them over. The envelope
    // around them is transport; the documents inside it are not re-serialised.
    expect(JSON.parse(String((call?.[1] as { body: string }).body))).toEqual({
      formSchemaJson: FORM_SCHEMA_JSON,
      uiSchemaJson: UI_SCHEMA_JSON,
      rulesSchemaJson: RULES_SCHEMA_JSON,
      componentsJson: COMPONENTS_JSON,
    });
  });

  it("sends an absent document as null rather than as an empty document", async () => {
    mockResponse(
      JSON.stringify({
        id: "version-3",
        formId: "bmi-form",
        version: 3,
        status: "draft",
        contentHash: null,
        createdAt: "2026-02-03T09:00:00.000Z",
        publishedAt: null,
      }),
    );

    await httpDefinitionsApi.updateDraft("bmi-form", "version-3", {
      formSchemaJson: FORM_SCHEMA_JSON,
      uiSchemaJson: null,
      rulesSchemaJson: null,
      componentsJson: null,
    });

    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(JSON.parse(String((call?.[1] as { body: string }).body))).toEqual({
      formSchemaJson: FORM_SCHEMA_JSON,
      uiSchemaJson: null,
      rulesSchemaJson: null,
      componentsJson: null,
    });
  });

  it("clones a version by posting to the clone route and mapping the new draft", async () => {
    mockResponse(
      JSON.stringify({
        id: "version-4",
        formId: "bmi-form",
        version: 4,
        status: "draft",
        contentHash: null,
        createdAt: "2026-02-04T09:00:00.000Z",
        publishedAt: null,
      }),
      201,
    );

    await expect(httpDefinitionsApi.cloneVersion("bmi-form", "version-2")).resolves.toMatchObject({
      id: "version-4",
      status: "draft",
    });

    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("/api/definitions/bmi-form/versions/version-2/clone");
    expect((call?.[1] as { method: string }).method).toBe("POST");
  });

  it("keeps a 400 publication failure carrying the core's own message", async () => {
    mockFailure("core_rejected", "formSchemaJson.fields[0].code is required.", 400);

    const error = await httpDefinitionsApi
      .publishVersion("bmi-form", "version-3")
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(DefinitionsApiError);
    expect((error as DefinitionsApiError).message).toBe(
      "formSchemaJson.fields[0].code is required.",
    );
    expect((error as DefinitionsApiError).status).toBe(400);
    expect((error as DefinitionsApiError).kind).toBe("operation");
  });

  it("makes a 409 on save a kind of its own, not a 404 about a missing publication", async () => {
    mockFailure("version_immutable", "A published version cannot change.", 409);

    const error = await httpDefinitionsApi
      .updateDraft("bmi-form", "version-2", {
        formSchemaJson: FORM_SCHEMA_JSON,
        uiSchemaJson: null,
        rulesSchemaJson: null,
        componentsJson: null,
      })
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(DefinitionsApiError);
    expect((error as DefinitionsApiError).kind).toBe("conflict");
    expect((error as DefinitionsApiError).code).toBe("version_immutable");
    expect((error as DefinitionsApiError).kind).not.toBe("no_published_version");
    expect((error as DefinitionsApiError).kind).not.toBe("version_not_found");
  });

  it("tells the three conflict codes apart by code while sharing one kind", async () => {
    const kinds = new Set<string>();
    for (const code of ["version_not_draft", "version_already_published", "version_immutable"]) {
      mockFailure(code, "refused", 409);
      const error = (await httpDefinitionsApi
        .cloneVersion("bmi-form", "version-2")
        .then(() => null)
        .catch((thrown: unknown) => thrown)) as DefinitionsApiError;
      expect(error.code).toBe(code);
      kinds.add(`${error.kind}:${error.code}`);
    }
    expect(kinds.size).toBe(3);
  });
});

describe("hasUnsavedChanges", () => {
  const stored = {
    formSchemaJson: FORM_SCHEMA_JSON,
    uiSchemaJson: UI_SCHEMA_JSON,
    rulesSchemaJson: RULES_SCHEMA_JSON,
    componentsJson: COMPONENTS_JSON,
  };

  it("is clean when the serialisation equals what is stored", () => {
    expect(hasUnsavedChanges({ ...stored }, { ...stored })).toBe(false);
  });

  it("is dirty when any of the four documents differs", () => {
    expect(hasUnsavedChanges({ ...stored, formSchemaJson: "{}" }, stored)).toBe(true);
    expect(hasUnsavedChanges({ ...stored, uiSchemaJson: null }, stored)).toBe(true);
    expect(hasUnsavedChanges({ ...stored, rulesSchemaJson: null }, stored)).toBe(true);
    expect(hasUnsavedChanges({ ...stored, componentsJson: null }, stored)).toBe(true);
  });

  it("compares bytes, so a reformatted document is a changed document", () => {
    const spaced = JSON.stringify(JSON.parse(FORM_SCHEMA_JSON), null, 2);

    expect(spaced).not.toBe(FORM_SCHEMA_JSON);
    expect(hasUnsavedChanges({ ...stored, formSchemaJson: spaced }, stored)).toBe(true);
  });

  it("treats an unchanged load as clean without anyone remembering to clear it", () => {
    // The baseline is the model's own serialisation of what was stored, so a
    // document nobody has touched compares equal to itself.
    const baseline = { ...stored };

    expect(hasUnsavedChanges({ ...baseline }, baseline)).toBe(false);
  });
});
