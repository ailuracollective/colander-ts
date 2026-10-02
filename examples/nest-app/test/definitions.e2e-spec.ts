import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "./../src/app.module.js";

/**
 * The definitions resource, over HTTP and over a real database.
 *
 * The whole suite runs against an in-memory SQLite: setting `COLANDER_DB_FILE`
 * to an in-memory url before the testing module is compiled is the only thing
 * `DbModule` needs — it reads the same variable `defaultDatabaseFile()` reads
 * in production. Migrations run, so the schema and the published-version
 * triggers under test are the real ones.
 *
 * The application is mounted with the `api` global prefix so the paths are the
 * ones the contract documents. Nest serves the routes themselves at `/…`; the
 * prefix is what the react example's dev proxy strips from `/api/…`.
 */

const DATABASE_FILE_ENV = "COLANDER_DB_FILE";
const MEMORY_URL = "file::memory:";

/**
 * A minimal document the core accepts. Written with the whitespace and key
 * order below on purpose: a stored version must come back as exactly this text,
 * and the content hash published with it must be the hash of exactly this text.
 */
const VALID_FORM_SCHEMA_JSON = '{\n  "fields": [\n    { "id": "email", "code": "email", "type": "text" }\n  ]\n}\n';
const VALID_CONTENT_HASH = "792fc0bc892631c1e3dd977748dee5fb0f40cfd11c5153a3ff7f773923fdd9dc";

/** A document the core rejects: `/fields` is a string, not an array. */
const INVALID_FORM_SCHEMA_JSON = '{"fields": "not-an-array"}';
const INVALID_CODE = "COMPILE_EXPECTED_ARRAY";

interface StoredVersion {
  id: string;
  formId: string;
  version: number;
  status: string;
  formSchemaJson: string;
  contentHash: string | null;
  createdAt: string;
  publishedAt: string | null;
}

describe("Definitions (e2e)", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  /** A definition with one published version, shared by the lifecycle tests. */
  let published: { formId: string; versionId: string; version: StoredVersion };

  async function createDefinition(name: string): Promise<string> {
    const response = await request(server).post("/api/definitions").send({ name }).expect(201);
    return response.body.id as string;
  }

  async function createDraft(formId: string, formSchemaJson: string): Promise<StoredVersion> {
    const response = await request(server)
      .post(`/api/definitions/${formId}/versions`)
      .send({ formSchemaJson })
      .expect(201);
    return response.body as StoredVersion;
  }

  beforeAll(async () => {
    process.env[DATABASE_FILE_ENV] = MEMORY_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
    server = app.getHttpServer();

    const formId = await createDefinition("Lifecycle form");
    const draft = await createDraft(formId, VALID_FORM_SCHEMA_JSON);
    const publishedResponse = await request(server)
      .post(`/api/definitions/${formId}/versions/${draft.id}/publish`)
      .expect(200);
    published = {
      formId,
      versionId: publishedResponse.body.id as string,
      version: publishedResponse.body as StoredVersion,
    };
  });

  afterAll(async () => {
    await app.close();
    delete process.env[DATABASE_FILE_ENV];
  });

  it("creates a definition and lists it", async () => {
    const created = await request(server)
      .post("/api/definitions")
      .send({ name: "Contact", description: "How to reach us" })
      .expect(201);

    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(created.body.name).toBe("Contact");
    expect(created.body.description).toBe("How to reach us");

    const list = await request(server).get("/api/definitions").expect(200);
    const found = list.body.find(
      (entry: { id: string; versionCount: number; isPublished: boolean }) =>
        entry.id === created.body.id,
    );
    expect(found).toEqual(
      expect.objectContaining({ name: "Contact", versionCount: 0, isPublished: false }),
    );
  });

  it("stores an invalid draft exactly as received", async () => {
    const formId = await createDefinition("Work in progress");
    const draft = await createDraft(formId, INVALID_FORM_SCHEMA_JSON);

    expect(draft.status).toBe("draft");
    // The bytes, not a re-serialization of a parsed document.
    expect(draft.formSchemaJson).toBe(INVALID_FORM_SCHEMA_JSON);

    const read = await request(server)
      .get(`/api/definitions/${formId}/versions/${draft.id}`)
      .expect(200);
    expect(read.body.version.formSchemaJson).toBe(INVALID_FORM_SCHEMA_JSON);
    expect(read.body.version.status).toBe("draft");
    expect(read.body.version.contentHash).toBeNull();
  });

  it("returns a live schemaCheck for the version's own document", async () => {
    const formId = await createDefinition("Checked form");
    const draft = await createDraft(formId, VALID_FORM_SCHEMA_JSON);

    const read = await request(server)
      .get(`/api/definitions/${formId}/versions/${draft.id}`)
      .expect(200);

    expect(read.body.schemaCheck.valid).toBe(true);
    // The hash is the hash of the stored text, byte for byte.
    expect(read.body.schemaCheck.contentHash).toBe(VALID_CONTENT_HASH);

    // The same dry-run on a document the core rejects reports the core's own
    // code, and is still only a read.
    const invalidId = await createDefinition("Unchecked form");
    const invalid = await createDraft(invalidId, INVALID_FORM_SCHEMA_JSON);
    const invalidRead = await request(server)
      .get(`/api/definitions/${invalidId}/versions/${invalid.id}`)
      .expect(200);
    expect(invalidRead.body.schemaCheck).toEqual({
      valid: false,
      code: INVALID_CODE,
      message: expect.stringContaining(INVALID_CODE),
    });
  });

  it("refuses to publish a document the core rejects, leaving the draft a draft", async () => {
    const formId = await createDefinition("Never publishable");
    const draft = await createDraft(formId, INVALID_FORM_SCHEMA_JSON);

    const refused = await request(server)
      .post(`/api/definitions/${formId}/versions/${draft.id}/publish`)
      .expect(400);
    expect(refused.body.message).toContain(INVALID_CODE);

    const read = await request(server)
      .get(`/api/definitions/${formId}/versions/${draft.id}`)
      .expect(200);
    expect(read.body.version.status).toBe("draft");
    expect(read.body.version.contentHash).toBeNull();
    expect(read.body.version.publishedAt).toBeNull();

    await request(server).get(`/api/definitions/${formId}/published`).expect(404);
  });

  it("publishes an accepted document, hashes it, and serves it as published", async () => {
    const formId = await createDefinition("Publishable form");
    const draft = await createDraft(formId, VALID_FORM_SCHEMA_JSON);

    const result = await request(server)
      .post(`/api/definitions/${formId}/versions/${draft.id}/publish`)
      .expect(200);

    expect(result.body.status).toBe("published");
    expect(result.body.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.body.publishedAt).not.toBeNull();

    const served = await request(server).get(`/api/definitions/${formId}/published`).expect(200);
    expect(served.body.id).toBe(draft.id);
    expect(served.body.contentHash).toBe(result.body.contentHash);
    expect(served.body.formSchemaJson).toBe(VALID_FORM_SCHEMA_JSON);
  });

  it("answers 409 to a PATCH and a DELETE on a published version, leaving it unchanged", async () => {
    const { formId, versionId } = published;
    const before = await request(server)
      .get(`/api/definitions/${formId}/versions/${versionId}`)
      .expect(200);

    const patched = await request(server)
      .patch(`/api/definitions/${formId}/versions/${versionId}`)
      .send({ formSchemaJson: '{"fields":[]}' })
      .expect(409);
    expect(patched.body.code).toBe("version_not_draft");

    const deleted = await request(server)
      .delete(`/api/definitions/${formId}/versions/${versionId}`)
      .expect(409);
    expect(deleted.body.code).toBe("version_immutable");

    const after = await request(server)
      .get(`/api/definitions/${formId}/versions/${versionId}`)
      .expect(200);
    expect(after.body.version).toEqual(before.body.version);
  });

  it("clones a published version into a new draft without touching the source", async () => {
    const { formId, versionId } = published;

    const clone = await request(server)
      .post(`/api/definitions/${formId}/versions/${versionId}/clone`)
      .send({})
      .expect(201);

    expect(clone.body.status).toBe("draft");
    expect(clone.body.id).not.toBe(versionId);
    expect(clone.body.version).toBe(published.version.version + 1);
    expect(clone.body.contentHash).toBeNull();
    expect(clone.body.formSchemaJson).toBe(published.version.formSchemaJson);

    // The published row is byte-identical: same documents, same hash, same
    // timestamps.
    const after = await request(server)
      .get(`/api/definitions/${formId}/versions/${versionId}`)
      .expect(200);
    expect(after.body.version).toEqual(published.version);
  });

  it("answers 404 with the machine code for an unknown definition", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";

    const read = await request(server).get(`/api/definitions/${unknown}`).expect(404);
    expect(read.body.code).toBe("definition_not_found");
    expect(read.body.message).toContain(unknown);

    const versions = await request(server).get(`/api/definitions/${unknown}/versions`).expect(404);
    expect(versions.body.code).toBe("definition_not_found");

    const publishedRead = await request(server)
      .get(`/api/definitions/${unknown}/published`)
      .expect(404);
    expect(publishedRead.body.code).toBe("definition_not_found");
  });
});
