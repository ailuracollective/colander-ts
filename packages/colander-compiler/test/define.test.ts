import { describe, expect, it } from "vitest";

import { defineMapping } from "../src/define.js";
import { planComponents } from "../src/plan.js";

function FieldShell(): null {
  return null;
}

function TextControl(): null {
  return null;
}
function TextareaControl(): null {
  return null;
}
function NumberControl(): null {
  return null;
}
function IntegerControl(): null {
  return null;
}
function BooleanControl(): null {
  return null;
}
function DateControl(): null {
  return null;
}
function DateTimeControl(): null {
  return null;
}
function TimeControl(): null {
  return null;
}
function ChoiceControl(): null {
  return null;
}

const everyType = {
  boolean: BooleanControl,
  choice: ChoiceControl,
  date: DateControl,
  datetime: DateTimeControl,
  integer: IntegerControl,
  number: NumberControl,
  text: TextControl,
  textarea: TextareaControl,
  time: TimeControl,
} as const;

describe(defineMapping, () => {
  it("reads each export name off the component the consumer wrote", () => {
    const mapping = defineMapping({
      components: everyType,
      module: "@/colander/controls",
      shell: FieldShell,
    });
    expect(mapping.components.text).toEqual({
      export: "TextControl",
      module: "@/colander/controls",
    });
    expect(mapping.components.datetime).toEqual({
      export: "DateTimeControl",
      module: "@/colander/controls",
    });
  });

  it("keeps the module in one place, so the mapping cannot drift from the module", () => {
    const mapping = defineMapping({
      components: everyType,
      module: "@/colander/controls",
      shell: FieldShell,
    });
    for (const source of Object.values(mapping.components)) {
      if (source !== undefined) {
        expect(source).toMatchObject({ module: "@/colander/controls" });
      }
    }
  });

  it("plans every type from a mapping declared with components", () => {
    const mapping = defineMapping({
        components: everyType,
        module: "@/colander/controls",
        shell: FieldShell,
      }),
      { plans, rejected } = planComponents(mapping);
    expect(plans).toHaveLength(9);
    expect(rejected.map((entry) => entry.type)).toEqual(["group", "repeater", "component-ref"]);
  });

  it("refuses a component with no export name, which nothing could import", () => {
    // A function whose name was removed: there is no name to import it under.
    const nameless = Object.defineProperty(() => null, "name", { value: "" });
    expect(() =>
      defineMapping({
        components: { text: nameless },
        module: "@/c",
        shell: FieldShell,
      }),
    ).toThrow(/is anonymous, so it has no export name to import/);
  });
});
