import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Why this guard is worth its maintenance.
 *
 * The per-type rules in this directory — the numeric step, the numeric answer,
 * the three temporal wire formats, the choice's "nothing is selected" value —
 * were written here by hand, twice and inconsistently, and nothing in the
 * repository said so. They now live in `@ailura/colander-compiler/utilities`,
 * and that is the whole reason to keep them there: a second consumer, or the
 * next person to add a tenth control, will otherwise write them again, and will
 * write them again slightly wrong, which is precisely how the two copies drifted
 * in the first place.
 *
 * So this file asserts the *absence* of the local rules, by name. The names are
 * the point: a control that reinvents a step under a new name would pass a test
 * that looked for behaviour, and there is nothing to render here — this app's
 * runner is `environment: "node"`, so a component cannot be exercised. The
 * precedent for a source-level guard in this app is
 * `src/lib/generated-tree.test.ts`, which reads a committed artifact and holds
 * it to the mapping in the same way.
 *
 * Reading the sources rather than importing them is also what lets this assert
 * something an import cannot: that a control reaches its decisions *through the
 * registry*, so a control that imported one family's function directly — or that
 * kept its own copy — fails here rather than rendering.
 */

/** The nine controls, in the core's own order, plus the file they shared. */
const CONTROL_FILES = [
  "text.tsx",
  "textarea.tsx",
  "number.tsx",
  "integer.tsx",
  "boolean.tsx",
  "date.tsx",
  "time.tsx",
  "datetime.tsx",
  "choice.tsx",
] as const;

const SHARED_FILE = "shared.tsx";

/**
 * The names that used to be declared in this directory. Each one is a per-type
 * decision, and each is now the compiler's.
 */
const RETIRED_NAMES = [
  "stepFor",
  "reportNumber",
  "parseLocalDate",
  "parseLocalClock",
  "parseLocalDateTime",
  "formatLocalDate",
  "formatLocalTime",
  "formatLocalDateTime",
  "atTime",
  "buildLocalDate",
  "buildLocalClock",
  "__colander_no_answer__",
] as const;

/** The specifier the controls reach the utilities by, rather than a deep path. */
const UTILITIES = "@ailura/colander-compiler/utilities";

/** Read a file in this directory, so the test does not depend on the cwd. */
function sourceOf(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

/**
 * A file with its comments removed, for the assertions about what code *does*.
 *
 * A guard that reads raw source has to say this, or it fails on prose: the
 * choice control's own comment quotes the `onChange([next])` it no longer runs,
 * because explaining what was wrong is the useful thing to say there. Stripping
 * the comments keeps the assertion about behaviour and lets the comment stay.
 */
function codeOf(file: string): string {
  return sourceOf(file)
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
}

const sources = new Map<string, string>([
  ...CONTROL_FILES.map((file) => [file, sourceOf(file)] as const),
  [SHARED_FILE, sourceOf(SHARED_FILE)] as const,
]);

describe("the controls and the compiler's per-type utilities", () => {
  it("declares one control per type the app materializes", () => {
    expect([...sources.keys()]).toEqual([...CONTROL_FILES, SHARED_FILE]);
  });

  it("has every control reach its decisions through the utilities entry point", () => {
    for (const file of CONTROL_FILES) {
      expect(sources.get(file), `${file} imports the utilities`).toContain(UTILITIES);
    }
  });

  it("has every control look its type up in the registry", () => {
    for (const file of CONTROL_FILES) {
      expect(sources.get(file), `${file} reads typeUtilities`).toContain("typeUtilities");
    }
  });

  it("keeps no control-local step, numeric parsing, temporal pattern or sentinel", () => {
    for (const [file, source] of sources) {
      for (const name of RETIRED_NAMES) {
        expect(source, `${file} declares no local \`${name}\``).not.toContain(name);
      }
    }
  });
});

describe("the choice control's answer shape", () => {
  const choiceCode = codeOf("choice.tsx");

  it("emits the shape the field's own `allowMultiple` calls for", () => {
    // The core is strict in both directions — `convert_single_choice` takes
    // `Json::as_str` and rejects a list, `convert_multi_choice` takes
    // `Json::Array` and rejects a scalar — so a control that emitted one shape
    // for both produced a validation error the user could not act on. This
    // version answered a dropdown with `["red"]`, and the core answered *must be
    // a choice value*.
    //
    // The assertion is on the source because there is nothing to render here:
    // this app's runner is `environment: "node"`, so the component cannot be
    // exercised without a DOM dependency this app does not have. Reading the
    // source still catches the regression that matters — a list emitted
    // unconditionally, or the flag dropped from the call. The comments are
    // stripped first, because this control's comment quotes the `onChange([next])`
    // it no longer runs in order to explain what was wrong.
    expect(choiceCode).toContain("allowMultiple");
    expect(choiceCode).toMatch(/answerFrom\(\s*next,\s*options,\s*allowMultiple\s*\)/);
    expect(choiceCode).not.toMatch(/onChange\(\[\s*next\s*\]\)/);
    expect(choiceCode).not.toMatch(/answerFrom\(\s*next,\s*options\s*\)/);
  });

  it("draws both configurations rather than degrading a multiple to one pick", () => {
    // The comment this file used to carry said a multiple choice "degrades to a
    // single pick" and reported a one-entry list. With `allowMultiple` deciding
    // the shape there is a real multi-select to draw, and the utility that
    // decides membership is `choiceHas`.
    expect(choiceCode).toMatch(/typeUtilities\.choice\.has\(/);
    expect(choiceCode).toContain("Checkbox");
  });
});
