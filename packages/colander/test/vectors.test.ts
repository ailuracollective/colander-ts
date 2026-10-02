/**
 * The same frozen vectors the Rust suite replays, driven through this binding.
 *
 * This does not re-test the core — the Rust suite does that, and it is the
 * authority. What it tests is that the bytes survive the WebAssembly boundary:
 * a run that agrees with all of these has not lost a character, a key order or
 * a number literal on the way in or out.
 *
 * The vectors are vendored under `test/fixtures/contract-vectors/` and verified
 * against `corpus.lock.json` before replay. `COLANDER_VECTORS` may point to an
 * explicit directory with an adjacent matching lock; no sibling or parent lock
 * is searched.
 *
 * The lock records the small set of entries that cannot cross this published ABI
 * boundary, with a reason for each exclusion. Every remaining group is replayed
 * and its count is asserted, so a changed corpus cannot silently shrink.
 */

import { describe, expect, it, vi } from "vite-plus/test";

import contractCorpus from "../scripts/contract-corpus.mjs";
import { ColanderError, colander } from "../src/index.ts";
import type {
  CompileRequest,
  ComponentReference,
  ContentHashRequest,
  EvaluateRulesRequest,
  ValidateResponseRequest,
} from "../src/types.ts";

vi.setConfig({ testTimeout: 5000 });
const { validateContractCorpus } = contractCorpus;

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

const corpus = validateContractCorpus();
const requiredVectorDirectory = corpus.directory;
const replayInventory = corpus.inventory;
type ReplayGroup = "hash" | "semver" | "validate" | "validateErrors" | "compile" | "rules";

function replay(group: ReplayGroup): Vector[] {
  return corpus.replay[group] as Vector[];
}

function expectVectorCount(group: string, entries: unknown[], expected: number): void {
  expect(
    entries,
    `${group}.json at ${requiredVectorDirectory} must contain ${expected} replayable vectors; found ${entries.length}`,
  ).toHaveLength(expected);
}

/** `raw_document` in the Rust harness: the fixture's exact text, or nothing. */
/**
 * A component reference as the ABI accepts it.
 *
 * The vectors record a component without a UI schema as an explicit
 * `uiSchemaJson: null`, because that is how the frozen record spells "absent".
 * The declared type has always been `uiSchemaJson?: string`, and the ABI reads
 * a *present* key as text, so a null is refused with
 * `'uiSchemaJson' must be a string when present`. Dropping the null-valued keys
 * turns the recorded "absent" into the absent the type means, and leaves the
 * vectors themselves untouched.
 */
function componentReferences(components: unknown): readonly ComponentReference[] {
  return (Array.isArray(components) ? components : []).map((component) => {
    const source = (typeof component === "object" && component !== null ? component : {}) as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.entries(source).filter(([, value]) => value !== null),
    ) as unknown as ComponentReference;
  });
}

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

// The checked-in corpus is the default; COLANDER_VECTORS is an explicit override with an adjacent lock.
describe("frozen vectors", () => {
  it("contentHash reproduces every recorded digest", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      entries = replay("hash");
    expectVectorCount("hash", entries, replayInventory.hash);

    for (const entry of entries) {
      const { ui, rules } = entry;
      const base = { formSchemaJson: entry.form as string };
      const request: ContentHashRequest = Object.assign(
        base,
        typeof ui === "string" ? { uiSchemaJson: ui } : {},
        typeof rules === "string" ? { rulesSchemaJson: rules } : {},
      );

      expect(core.contentHash(request), entry.name).toBe(entry.hash);
    }
  });

  it("nextVersion reproduces every recorded next", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      entries = replay("semver");
    expectVectorCount("semver", entries, replayInventory.semver);

    for (const entry of entries) {
      const published = entry.published ?? [];
      expect(core.nextVersion({ published }), entry.name).toBe(entry.next);
    }
  });

  it("validateResponse reproduces every recorded answer set", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      entries = replay("validate");
    expectVectorCount("validate", entries, replayInventory.validate);

    for (const entry of entries) {
      const ui = rawDocument(entry, "uiRaw");
      const rules = rawDocument(entry, "rulesRaw");
      const base = {
        answersJson: rawDocument(entry, "answersRaw") as string,
        formSchemaJson: rawDocument(entry, "formRaw") as string,
      };
      const request: ValidateResponseRequest = Object.assign(
        base,
        ui === undefined ? {} : { uiSchemaJson: ui },
        rules === undefined ? {} : { rulesSchemaJson: rules },
        entry.mode === "Complete" ? { mode: "Complete" as const } : {},
      );

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
      entries = replay("validateErrors");
    expectVectorCount("validate errors", entries, replayInventory.validateErrors);

    for (const entry of entries) {
      const ui = rawDocument(entry, "uiRaw");
      const rules = rawDocument(entry, "rulesRaw");
      const base = {
        answersJson: rawDocument(entry, "answersRaw") as string,
        formSchemaJson: rawDocument(entry, "formRaw") as string,
      };
      const request: ValidateResponseRequest = Object.assign(
        base,
        ui === undefined ? {} : { uiSchemaJson: ui },
        rules === undefined ? {} : { rulesSchemaJson: rules },
      );

      expect(() => core.validateResponse(request), entry.name).toThrow(ColanderError);
    }
  });

  it("compile reproduces every recorded compilation", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      entries = replay("compile");
    expectVectorCount("compile", entries, replayInventory.compile);

    for (const entry of entries) {
      const ui = rawDocument(entry, "uiRaw");
      const rules = rawDocument(entry, "rulesRaw");
      const base = { formSchemaJson: rawDocument(entry, "formRaw") as string };
      const request: CompileRequest = Object.assign(
        base,
        ui === undefined ? {} : { uiSchemaJson: ui },
        rules === undefined ? {} : { rulesSchemaJson: rules },
        entry.components === undefined
          ? {}
          : {
              // The vectors carry components as loose string maps; the ABI reads
              // The keys it knows and ignores the rest.
              components: componentReferences(entry.components),
            },
      );

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
      const fixtureBase = { formSchemaJson: expected.formSchemaJson };
      const fromFixture: ContentHashRequest = Object.assign(
        fixtureBase,
        expected.uiSchemaJson === null ? {} : { uiSchemaJson: expected.uiSchemaJson },
        expected.rulesSchemaJson === null ? {} : { rulesSchemaJson: expected.rulesSchemaJson },
      );
      expect(core.contentHash(fromFixture), entry.name).toBe(expected.contentHash);

      // And the compiled form's own hash is that same builder over its own output.
      const compiledBase = { formSchemaJson: actual.formSchemaJson };
      const fromCompiled: ContentHashRequest = Object.assign(
        compiledBase,
        actual.uiSchemaJson === null ? {} : { uiSchemaJson: actual.uiSchemaJson },
        actual.rulesSchemaJson === null ? {} : { rulesSchemaJson: actual.rulesSchemaJson },
      );
      expect(core.contentHash(fromCompiled), entry.name).toBe(actual.contentHash);
    }
  });

  it("evaluateRules reproduces every recorded evaluation", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      entries = replay("rules");
    expectVectorCount("rules", entries, replayInventory.rules);

    for (const entry of entries) {
      const ui = rawDocument(entry, "uiRaw");
      const base = {
        formSchemaJson: rawDocument(entry, "formRaw") as string,
        rulesSchemaJson: rawDocument(entry, "rulesRaw") as string,
      };
      const request: EvaluateRulesRequest = Object.assign(
        base,
        ui === undefined ? {} : { uiSchemaJson: ui },
        entry.values === undefined ? {} : { values: entry.values },
      );

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
