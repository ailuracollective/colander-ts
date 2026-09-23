/**
 * The same frozen vectors the Rust suite replays, driven through this binding.
 *
 * This does not re-test the core — the Rust suite does that, and it is the
 * authority. What it tests is that the bytes survive the WebAssembly boundary:
 * a run that agrees with all of these has not lost a character, a key order or
 * a number literal on the way in or out.
 *
 * The vectors live in the sibling `colander` checkout. When it is not there,
 * the group skips rather than fails: the package is usable without it, and a
 * checkout of `colander` alone has no reason to carry this one.
 *
 * Not every group is replayed. `canonical` drives an internal serializer and
 * `errors` drives internal helpers, so neither is reachable through the ABI;
 * `semver`'s ensure-valid and compare vectors likewise, leaving only its `next`
 * group. The counts below are therefore deliberate and are asserted, so a
 * vector file that changes shape is noticed instead of silently shrinking.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import { ColanderError, colander } from "../src/index.ts";
import type {
  CompileRequest,
  ComponentReference,
  ContentHashRequest,
  EvaluateRulesRequest,
  ValidateResponseRequest,
} from "../src/types.ts";

vi.setConfig({ testTimeout: 5000 });

interface Vector {
  name: string;
  error?: string | null;
  hash?: string;
  next?: string;
  published?: string[];
  mode?: string;
  raw?: Record<string, string | null>;
  components?: Record<string, string>[];
  values?: Record<string, unknown>;
  expected?: Record<string, unknown> | null;
  [key: string]: unknown;
}

const CANDIDATES = [
    process.env.COLANDER_VECTORS,
    new URL("../../colander/tests/golden/vectors/", import.meta.url).pathname,
    new URL("../../../colander/tests/golden/vectors/", import.meta.url).pathname,
  ].filter((value): value is string => typeof value === "string"),
  VECTOR_DIR = CANDIDATES.find((dir) => existsSync(join(dir, "hash.json")));

function load(group: string): Vector[] {
  const path = join(VECTOR_DIR as string, `${group}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Vector[];
}

/** `raw_document` in the Rust harness: the fixture's exact text, or nothing. */
function rawDocument(entry: Vector, key: string): string | undefined {
  const value = entry.raw?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Key-sorted, like the Rust harness's `canonical_document`.
 *
 * The recorded compiled documents are in *document* order, while colander emits
 * them key-sorted, so `compile` has to be compared canonically. This goes
 * through `JSON.parse`, which means it does not carry raw number literals —
 * the `contentHash` assertions below are what pin those exactly.
 */
function canonical(text: string | null): string | null {
  if (text === null) {
    return null;
  }
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(sort);
    }
    if (value !== null && typeof value === "object") {
      const source = value as Record<string, unknown>,
        out: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) {
        out[key] = sort(source[key]);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(sort(JSON.parse(text)));
}

// Set COLANDER_VECTORS to point at the vectors when colander is elsewhere.
describe.skipIf(VECTOR_DIR === undefined)("frozen vectors", () => {
  it("contentHash reproduces every recorded digest", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      entries = load("hash").filter((entry) => typeof entry.hash === "string");
    expect(entries).toHaveLength(8);

    for (const entry of entries) {
      const request: ContentHashRequest = { formSchemaJson: entry.form as string },
        { ui } = entry,
        { rules } = entry;
      if (typeof ui === "string") {
        request.uiSchemaJson = ui;
      }
      if (typeof rules === "string") {
        request.rulesSchemaJson = rules;
      }

      expect(core.contentHash(request), entry.name).toBe(entry.hash);
    }
  });

  it("nextVersion reproduces every recorded next", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      entries = load("semver").filter((entry) => typeof entry.next === "string");
    expect(entries).toHaveLength(6);

    for (const entry of entries) {
      const published = entry.published ?? [];
      expect(core.nextVersion({ published }), entry.name).toBe(entry.next);
    }
  });

  it("validateResponse reproduces every recorded answer set", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      entries = load("validate").filter(
        (entry) => entry.expected !== null && entry.expected !== undefined,
      );
    expect(entries).toHaveLength(59);

    for (const entry of entries) {
      const request: ValidateResponseRequest = {
          answersJson: rawDocument(entry, "answersRaw") as string,
          formSchemaJson: rawDocument(entry, "formRaw") as string,
        },
        ui = rawDocument(entry, "uiRaw"),
        rules = rawDocument(entry, "rulesRaw");
      if (ui !== undefined) {
        request.uiSchemaJson = ui;
      }
      if (rules !== undefined) {
        request.rulesSchemaJson = rules;
      }
      if (entry.mode === "Complete") {
        request.mode = "Complete";
      }

      const actual = core.validateResponse(request),
        expected = entry.expected as {
          normalizedAnswersJson: string;
          errors?: unknown[];
        };

      expect(actual.normalizedAnswersJson, entry.name).toBe(expected.normalizedAnswersJson);
      if (expected.errors !== undefined) {
        expect(actual.errors, entry.name).toStrictEqual(expected.errors);
      }
      expect(actual.isValid, entry.name).toBe(actual.errors.length === 0);
    }
  });

  it("validateResponse refuses what the fixture also refused", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      entries = load("validate").filter(
        (entry) => typeof entry.error === "string" && entry.error.length > 0,
      );
    expect(entries).toHaveLength(8);

    for (const entry of entries) {
      const request: ValidateResponseRequest = {
          answersJson: rawDocument(entry, "answersRaw") as string,
          formSchemaJson: rawDocument(entry, "formRaw") as string,
        },
        ui = rawDocument(entry, "uiRaw"),
        rules = rawDocument(entry, "rulesRaw");
      if (ui !== undefined) {
        request.uiSchemaJson = ui;
      }
      if (rules !== undefined) {
        request.rulesSchemaJson = rules;
      }

      expect(() => core.validateResponse(request), entry.name).toThrow(ColanderError);
    }
  });

  it("compile reproduces every recorded compilation", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      entries = load("compile").filter(
        (entry) => entry.expected !== null && entry.expected !== undefined,
      );
    expect(entries).toHaveLength(13);

    for (const entry of entries) {
      const request: CompileRequest = {
          formSchemaJson: rawDocument(entry, "formRaw") as string,
        },
        ui = rawDocument(entry, "uiRaw"),
        rules = rawDocument(entry, "rulesRaw");
      if (ui !== undefined) {
        request.uiSchemaJson = ui;
      }
      if (rules !== undefined) {
        request.rulesSchemaJson = rules;
      }
      if (entry.components !== undefined) {
        // The vectors carry components as loose string maps; the ABI reads the
        // Keys it knows and ignores the rest.
        request.components = entry.components as unknown as ComponentReference[];
      }

      const actual = core.compile(request),
        expected = entry.expected as {
          formSchemaJson: string;
          uiSchemaJson: string | null;
          rulesSchemaJson: string | null;
          dependencyMetadataJson: string;
          contentHash: string;
        };

      expect(canonical(actual.formSchemaJson), entry.name).toBe(canonical(expected.formSchemaJson));
      expect(canonical(actual.uiSchemaJson), entry.name).toBe(canonical(expected.uiSchemaJson));
      expect(canonical(actual.rulesSchemaJson), entry.name).toBe(
        canonical(expected.rulesSchemaJson),
      );
      expect(canonical(actual.dependencyMetadataJson), entry.name).toBe(
        canonical(expected.dependencyMetadataJson),
      );

      // The recorded digest covers the recorded documents, so hashing them back
      // Through the published entry point has to land on the same value. This is
      // The byte-exact half of the comparison: key order, escaping and number
      // Literals all feed it.
      const fromFixture: ContentHashRequest = { formSchemaJson: expected.formSchemaJson };
      if (expected.uiSchemaJson !== null) {
        fromFixture.uiSchemaJson = expected.uiSchemaJson;
      }
      if (expected.rulesSchemaJson !== null) {
        fromFixture.rulesSchemaJson = expected.rulesSchemaJson;
      }
      expect(core.contentHash(fromFixture), entry.name).toBe(expected.contentHash);

      // And the compiled form's own hash is that same builder over its own output.
      const fromCompiled: ContentHashRequest = { formSchemaJson: actual.formSchemaJson };
      if (actual.uiSchemaJson !== null) {
        fromCompiled.uiSchemaJson = actual.uiSchemaJson;
      }
      if (actual.rulesSchemaJson !== null) {
        fromCompiled.rulesSchemaJson = actual.rulesSchemaJson;
      }
      expect(core.contentHash(fromCompiled), entry.name).toBe(actual.contentHash);
    }
  });

  it("evaluateRules reproduces every recorded evaluation", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      // The analyzer and dependency-check vectors drive functions the ABI does not
      // Expose; the three below carry errors from the fixture's own value parser,
      // Which the engine never sees.
      UNREACHABLE = new Set([
        "empty-json-array-value",
        "values-with-nested-array",
        "values-with-nested-object",
      ]),
      entries = load("rules").filter(
        (entry) =>
          entry.expected !== null &&
          entry.expected !== undefined &&
          !entry.name.startsWith("analyze:") &&
          !entry.name.startsWith("validateDependencies:") &&
          !UNREACHABLE.has(entry.name),
      );
    expect(entries).toHaveLength(38);

    for (const entry of entries) {
      const request: EvaluateRulesRequest = {
          formSchemaJson: rawDocument(entry, "formRaw") as string,
          rulesSchemaJson: rawDocument(entry, "rulesRaw") as string,
        },
        ui = rawDocument(entry, "uiRaw");
      if (ui !== undefined) {
        request.uiSchemaJson = ui;
      }
      if (entry.values !== undefined) {
        request.values = entry.values;
      }

      const actual = core.evaluateRules(request),
        expected = entry.expected as Record<string, unknown>;

      // Only the keys the fixture records are compared, exactly as the Rust
      // Harness does: a map may legitimately carry fields the vector omits.
      for (const map of ["visibility", "enabled", "required"] as const) {
        const recorded = expected[map] as Record<string, boolean> | undefined;
        if (recorded === undefined) {
          continue;
        }
        for (const [field, value] of Object.entries(recorded)) {
          expect(actual[map][field] ?? false, `${entry.name} ${map}.${field}`).toBe(value);
        }
      }

      expect(actual.calculatedValues, `${entry.name} calculatedValues`).toStrictEqual(
        expected.calculatedValues ?? {},
      );
      expect(actual.validationErrors, `${entry.name} validationErrors`).toStrictEqual(
        expected.validationErrors ?? [],
      );
    }
  });
});
