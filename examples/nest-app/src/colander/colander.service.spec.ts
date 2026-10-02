import { readFileSync } from "node:fs";

import { ColanderError } from "@ailura/colander";
import type { LoadedCore } from "@ailura/colander";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";

import { COLANDER_CORE } from "./colander.constants.js";
import { ColanderModule } from "./colander.module.js";
import { ColanderService } from "./colander.service.js";

const CONTENT_HASH = "1e75829291a1604e424af6e917ae40c87643ba6162bc6d2ad5f62585983f038b";

interface Fixture {
  form: unknown;
  rules: unknown;
}

function loadFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), "utf8"),
  ) as Fixture;
}

const bmi = loadFixture("bmi-calculation.json");
const bp = loadFixture("bp-cross-field.json");
const bmiForm = JSON.stringify(bmi.form);
const bmiRules = JSON.stringify(bmi.rules);
const bpForm = JSON.stringify(bp.form);
const bpRules = JSON.stringify(bp.rules);

describe("ColanderModule loads the real WebAssembly core", () => {
  let moduleRef: TestingModule;
  let core: LoadedCore;
  let service: ColanderService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ColanderModule],
    }).compile();
    core = moduleRef.get<LoadedCore>(COLANDER_CORE);
    service = moduleRef.get(ColanderService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("resolves the packaged core and its identity", () => {
    expect(core).toBeDefined();
    expect(service.abiVersion).toBe(1);
    // The exact version is owned by the core package's corpus lock, so this suite asserts the
    // identity and the shape, never a literal that drifts on the next engine repin.
    const versionInfo = service.versionInfo();
    expect(versionInfo.name).toBe("colander");
    expect(versionInfo.abi).toBe(1);
    expect(versionInfo.version).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("compiles the BMI fixture to the golden content hash", () => {
    const compiled = service.compile({
      formSchemaJson: bmiForm,
      rulesSchemaJson: bmiRules,
    });

    expect(compiled.contentHash).toBe(CONTENT_HASH);
  });

  it("calculates BMI by field code and disables the read-only field by id", () => {
    const evaluation = service.evaluateRules({
      formSchemaJson: bmiForm,
      rulesSchemaJson: bmiRules,
      values: { "body.weight.kg": 70, "body.height.m": 1.75 },
    });

    expect(evaluation.calculatedValues["body.bmi"]).toBe(22.86);
    expect(evaluation.enabled["bmi"]).toBe(false);
  });

  it("returns the next patch above the published versions", () => {
    expect(service.nextVersion({ published: ["1.0.0"] })).toBe("1.0.1");
  });

  it("reports the blood-pressure cross-field validation code", () => {
    const evaluation = service.evaluateRules({
      formSchemaJson: bpForm,
      rulesSchemaJson: bpRules,
      values: { "vital.bp.systolic": 120, "vital.bp.diastolic": 130 },
    });

    expect(evaluation.validationErrors[0].code).toBe("BP_SYSTOLIC_GT_DIASTOLIC");
  });

  it("accepts the same answers in Draft but rejects them in Complete", () => {
    const answersJson = JSON.stringify({
      "vital.bp.systolic": 120,
      "vital.bp.diastolic": 130,
    });

    const complete = service.validateResponse({
      formSchemaJson: bpForm,
      rulesSchemaJson: bpRules,
      answersJson,
      mode: "Complete",
    });
    expect(complete.isValid).toBe(false);
    expect(complete.errors[0].code).toBe("BP_SYSTOLIC_GT_DIASTOLIC");

    const draft = service.validateResponse({
      formSchemaJson: bpForm,
      rulesSchemaJson: bpRules,
      answersJson,
      mode: "Draft",
    });
    expect(draft.isValid).toBe(true);
    expect(draft.errors).toEqual([]);
  });

  it("rejects an unparseable form schema with a validation ColanderError", () => {
    let caught: unknown;
    try {
      service.compile({ formSchemaJson: "not json" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ColanderError);
    expect((caught as ColanderError).kind).toBe("validation");
  });
});
