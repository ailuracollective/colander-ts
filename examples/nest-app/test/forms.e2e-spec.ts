import { readFileSync } from "node:fs";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "./../src/app.module.js";

const CONTENT_HASH = "1e75829291a1604e424af6e917ae40c87643ba6162bc6d2ad5f62585983f038b";

interface Fixture {
  form: unknown;
  rules: unknown;
}

function loadFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as Fixture;
}

const bmi = loadFixture("bmi-calculation.json");
const bp = loadFixture("bp-cross-field.json");
const bmiBody = {
  formSchemaJson: JSON.stringify(bmi.form),
  rulesSchemaJson: JSON.stringify(bmi.rules),
};
const bpBody = {
  formSchemaJson: JSON.stringify(bp.form),
  rulesSchemaJson: JSON.stringify(bp.rules),
};
const bpAnswersJson = JSON.stringify({
  "vital.bp.systolic": 120,
  "vital.bp.diastolic": 130,
});

describe("Forms (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /forms/core reports the colander identity", async () => {
    const response = await request(app.getHttpServer()).get("/forms/core").expect(200);

    // See colander.service.spec.ts: the version literal belongs to the core package's corpus lock.
    expect(response.body.abiVersion).toBe(1);
    expect(response.body.versionInfo.name).toBe("colander");
    expect(response.body.versionInfo.abi).toBe(1);
    expect(response.body.versionInfo.version).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("POST /forms/compile returns the golden content hash", async () => {
    const response = await request(app.getHttpServer())
      .post("/forms/compile")
      .send(bmiBody)
      .expect(200);

    expect(response.body.contentHash).toBe(CONTENT_HASH);
  });

  it("POST /forms/validate-response rejects the failing answers in Complete", async () => {
    const response = await request(app.getHttpServer())
      .post("/forms/validate-response")
      .send({ ...bpBody, answersJson: bpAnswersJson, mode: "Complete" })
      .expect(200);

    expect(response.body.isValid).toBe(false);
    expect(response.body.errors[0].code).toBe("BP_SYSTOLIC_GT_DIASTOLIC");
  });

  it("POST /forms/validate-response accepts the same answers in Draft", async () => {
    const response = await request(app.getHttpServer())
      .post("/forms/validate-response")
      .send({ ...bpBody, answersJson: bpAnswersJson, mode: "Draft" })
      .expect(200);

    expect(response.body.isValid).toBe(true);
    expect(response.body.errors).toEqual([]);
  });

  it("POST /forms/compile maps an invalid document to 400 through the filter", async () => {
    const response = await request(app.getHttpServer())
      .post("/forms/compile")
      .send({ formSchemaJson: "not json" })
      .expect(400);

    expect(response.body.kind).toBe("validation");
  });
});
