import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "./../src/app.module.js";

/**
 * The responses resource, over HTTP and over a real database.
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
/**
 * An in-memory database, the same literal the definitions suite uses: every
 * call to `openDatabase` gets a private database regardless of which of the
 * recognised in-memory forms was asked for.
 *
 * The shared-cache form is one database per process, so two suites using it in
 * the same worker would migrate and write the same file at once and lock each
 * other out. `:memory:` is scoped to this connection, which is what makes two
 * e2e files that both talk to a database able to run side by side.
 */
const MEMORY_URL = "file::memory:";

/** The same minimal document the definitions suite publishes. */
const VALID_FORM_SCHEMA_JSON =
  '{\n  "fields": [\n    { "id": "email", "code": "email", "type": "text" }\n  ]\n}\n';

/** Answer keys are field *codes*, as the core documents. */
const VALID_ANSWERS_JSON = '{"email":"someone@example.com"}';
/** A number where the field is text: the core reports `INVALID_TYPE`. */
const INVALID_ANSWERS_JSON = '{"email":123}';
const INVALID_CODE = "INVALID_TYPE";

interface StoredVersion {
  id: string;
  formId: string;
  status: string;
}

interface StoredResponse {
  id: string;
  formId: string;
  versionId: string;
  answersJson: string;
  validationJson: string | null;
  isValid: boolean;
  createdAt: string;
}

describe("Responses (e2e)", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

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

  /** A form with one published version, which is what a submission needs. */
  async function createPublishedForm(name: string): Promise<{ formId: string; versionId: string }> {
    const formId = await createDefinition(name);
    const draft = await createDraft(formId, VALID_FORM_SCHEMA_JSON);
    const published = await request(server)
      .post(`/api/definitions/${formId}/versions/${draft.id}/publish`)
      .expect(200);
    return { formId, versionId: published.body.id as string };
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
  });

  afterAll(async () => {
    await app.close();
    delete process.env[DATABASE_FILE_ENV];
  });

  it("stores an invalid answer with the core's own verdict on it", async () => {
    const { formId, versionId } = await createPublishedForm("Invalid answers");

    const created = await request(server)
      .post("/api/responses")
      .send({ formId, answersJson: INVALID_ANSWERS_JSON })
      .expect(201);

    const stored = created.body as StoredResponse;
    // 201 means "recorded", not "accepted".
    expect(stored.isValid).toBe(false);
    expect(stored.formId).toBe(formId);
    expect(stored.versionId).toBe(versionId);
    // The bytes as they arrived, not a re-serialization of a parsed document.
    expect(stored.answersJson).toBe(INVALID_ANSWERS_JSON);

    // What the core says about exactly those answers over exactly that
    // document, asked of the core directly through the computation route.
    const coreVerdict = await request(server)
      .post("/api/forms/validate-response")
      .send({ formSchemaJson: VALID_FORM_SCHEMA_JSON, answersJson: INVALID_ANSWERS_JSON })
      .expect(200);
    expect(JSON.parse(stored.validationJson ?? "null")).toEqual(coreVerdict.body);
    expect(coreVerdict.body.errors[0].code).toBe(INVALID_CODE);

    // And the stored row is the same one the read routes serve.
    const read = await request(server).get(`/api/responses/${stored.id}`).expect(200);
    expect(read.body).toEqual(stored);
  });

  it("stores a valid answer and records it as valid", async () => {
    const { formId, versionId } = await createPublishedForm("Valid answers");

    const created = await request(server)
      .post("/api/responses")
      .send({ formId, answersJson: VALID_ANSWERS_JSON })
      .expect(201);

    const stored = created.body as StoredResponse;
    expect(stored.isValid).toBe(true);
    expect(stored.versionId).toBe(versionId);
    expect(stored.answersJson).toBe(VALID_ANSWERS_JSON);
    expect(JSON.parse(stored.validationJson ?? "null")).toEqual({
      normalizedAnswersJson: VALID_ANSWERS_JSON,
      errors: [],
      isValid: true,
    });
  });

  it("answers 409 to a submission against a version that is still a draft", async () => {
    const { formId } = await createPublishedForm("Draft target");
    const draft = await createDraft(formId, VALID_FORM_SCHEMA_JSON);

    const refused = await request(server)
      .post("/api/responses")
      .send({ formId, answersJson: VALID_ANSWERS_JSON, versionId: draft.id })
      .expect(409);
    expect(refused.body.code).toBe("response_version_not_published");
    expect(refused.body.message).toContain(draft.id);

    // Nothing was recorded against the draft.
    const list = await request(server).get("/api/responses").query({ formId }).expect(200);
    expect(list.body).toEqual([]);
  });

  it("answers 409 to a submission naming a version of another form", async () => {
    const mine = await createPublishedForm("Own form");
    const other = await createPublishedForm("Other form");

    const refused = await request(server)
      .post("/api/responses")
      .send({ formId: mine.formId, answersJson: VALID_ANSWERS_JSON, versionId: other.versionId })
      .expect(409);
    expect(refused.body.code).toBe("response_version_mismatch");
    expect(refused.body.message).toContain(other.versionId);
  });

  it("lists one form's responses and fetches one by id", async () => {
    const first = await createPublishedForm("Listed form");
    const second = await createPublishedForm("Unlisted form");

    const mine = await request(server)
      .post("/api/responses")
      .send({ formId: first.formId, answersJson: VALID_ANSWERS_JSON })
      .expect(201);
    await request(server)
      .post("/api/responses")
      .send({ formId: second.formId, answersJson: VALID_ANSWERS_JSON })
      .expect(201);

    const list = await request(server).get("/api/responses").query({ formId: first.formId });
    expect(list.status).toBe(200);
    const rows = list.body as StoredResponse[];
    // Another form's response is not in this list, even though it exists.
    expect(rows).toHaveLength(1);
    expect(rows.every((row) => row.formId === first.formId)).toBe(true);
    expect(rows[0].id).toBe(mine.body.id);

    const read = await request(server).get(`/api/responses/${mine.body.id}`).expect(200);
    expect(read.body).toEqual(mine.body);

    const unknown = await request(server)
      .get("/api/responses/00000000-0000-4000-8000-000000000000")
      .expect(404);
    expect(unknown.body.code).toBe("response_not_found");
  });

  it("answers 404 no_published_version for a form with nothing published", async () => {
    const formId = await createDefinition("Never published");
    await createDraft(formId, VALID_FORM_SCHEMA_JSON);

    const refused = await request(server)
      .post("/api/responses")
      .send({ formId, answersJson: VALID_ANSWERS_JSON })
      .expect(404);
    expect(refused.body.code).toBe("no_published_version");
    expect(refused.body.message).toContain(formId);
  });
});
