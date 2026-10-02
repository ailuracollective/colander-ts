import { COLANDER_FIELD_TYPES } from "@ailura/colander-client";
import { describe, expect, it } from "vitest";

import type { ControlChange, ControlValue } from "../src/host.js";
import { assertCompleteMapping, planComponents } from "../src/plan.js";
import type {
  ComponentMapping,
  ComponentSource,
  ImportedComponent,
  MaterializableFieldType,
} from "../src/plan.js";

const SHELL: ImportedComponent = { export: "FieldShell", module: "@/components/field-shell" };

function control(name: string): ImportedComponent {
  return { export: `${name}Control`, module: `@/components/controls/${name}` };
}

function fullMapping(): ComponentMapping {
  return {
    components: {
      boolean: control("boolean"),
      choice: control("choice"),
      date: control("date"),
      datetime: control("datetime"),
      integer: control("number"),
      number: control("number"),
      text: control("text"),
      textarea: control("textarea"),
      time: control("time"),
    },
    shell: SHELL,
  };
}

describe(planComponents, () => {
  it("carries the value shape the core declares for each type", () => {
    const { plans } = planComponents(fullMapping());
    expect(Object.fromEntries(plans.map((plan) => [plan.type, plan.value]))).toEqual({
      boolean: "boolean",
      choice: "string-or-string-list",
      date: "string",
      datetime: "string",
      integer: "number",
      number: "number",
      text: "string",
      textarea: "string",
      time: "string",
    });
  });

  it("carries the core's own properties for a type, in the core's order", () => {
    const { plans } = planComponents(fullMapping()),
      text = plans.find((plan) => plan.type === "text");
    expect(text?.properties).toEqual([
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "minLength", type: "number" },
      { name: "maxLength", type: "number" },
      { name: "pattern", type: "string" },
    ]);
  });

  it("lets two types share one component without merging their properties", () => {
    const { plans } = planComponents(fullMapping()),
      numeric = plans.filter((plan) => plan.type === "number" || plan.type === "integer");
    expect(numeric).toHaveLength(2);
    expect(numeric[0]?.component).toEqual(numeric[1]?.component);
    expect(numeric[0]?.properties.map((property) => property.name)).not.toEqual(
      numeric[1]?.properties.map((property) => property.name),
    );
  });

  it("is deterministic for the same input", () => {
    expect(JSON.stringify(planComponents(fullMapping()))).toBe(
      JSON.stringify(planComponents(fullMapping())),
    );
  });

  it("plans only types the core vocabulary declares", () => {
    const { plans } = planComponents(fullMapping());
    for (const plan of plans) {
      expect(COLANDER_FIELD_TYPES).toContain(plan.type);
    }
  });
});

describe("declined types", () => {
  it("declines every container with a stated reason", () => {
    const { plans, rejected } = planComponents(fullMapping()),
      containers = rejected.filter((entry) => entry.kind === "not-materializable");
    expect(containers.map((entry) => entry.type)).toEqual(["group", "repeater", "component-ref"]);
    for (const entry of containers) {
      expect(entry.reason).toContain(entry.type);
    }
    expect(plans.map((plan) => plan.type)).not.toContain("group");
  });

  it("declines a materializable type the consumer did not map, rather than dropping it", () => {
    const mapping = fullMapping(),
      components: Partial<Record<MaterializableFieldType, ComponentSource>> = {
        ...mapping.components,
      };
    delete components.choice;
    const { plans, rejected } = planComponents({ ...mapping, components }),
      unmapped = rejected.filter((entry) => entry.kind === "unmapped");
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]?.type).toBe("choice");
    expect(unmapped[0]?.reason).toContain("choice");
    expect(plans.map((plan) => plan.type)).not.toContain("choice");
  });
});

describe("an unusable mapping", () => {
  it("rejects a control with an empty export", () => {
    const mapping = fullMapping();
    expect(() =>
      planComponents({
        ...mapping,
        components: { ...mapping.components, text: { export: "", module: "@/x" } },
      }),
    ).toThrow(/the `text` control is not usable: `export` must be a non-empty export name/);
  });

  it("reads an explicitly undefined component as unmapped, not as a crash", () => {
    const mapping = fullMapping(),
      // A mapping written by a config loader can hold an explicit `undefined`
      // Where a hand-written one would omit the key, and under
      // `exactOptionalPropertyTypes` admitting that needs the wider type.
      components: Record<string, ComponentSource | undefined> = {
        ...mapping.components,
        text: undefined,
      },
      { plans, rejected } = planComponents({ ...mapping, components });
    expect(plans.map((plan) => plan.type)).not.toContain("text");
    expect(rejected.find((entry) => entry.type === "text")?.kind).toBe("unmapped");
  });

  it("declines a type the mapping names that the core does not materialize, and says so", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components, group: control("group") } as Record<
        string,
        ImportedComponent
      >,
      { plans, rejected } = planComponents({
        ...mapping,
        components,
      });
    expect(plans.map((plan) => plan.type)).not.toContain("group");
    const entry = rejected.find((rejection) => rejection.type === "group");
    expect(entry?.kind).toBe("not-materializable");
    expect(entry?.reason).toContain("group");
    expect(entry?.reason).toContain("ignored");
  });
});

describe("the value shapes a generated control is given", () => {
  it("lets a text or number control report an absent answer, but not a boolean", () => {
    const change: ControlChange<"string"> = null,
      numeric: ControlChange<"number"> = null,
      flag: ControlChange<"boolean"> = true,
      // @ts-expect-error a boolean is always an answer, checked or not
      absentFlag: ControlChange<"boolean"> = null;
    expect([change, numeric, flag, absentFlag]).toHaveLength(4);
  });

  it("gives a choice's outbound answer the shape its own `allowMultiple` calls for", () => {
    // The core is strict in both directions: a single-select takes a scalar and
    // A multiple takes a list, and each rejects the other. The second parameter
    // Is what lets that be a compile error rather than a validation error the
    // User meets. `ControlValue` is the other direction and is a union in both
    // Cases, because an existing answer can legitimately arrive as either.
    const cleared: ControlChange<"string-or-string-list"> = null,
      single: ControlChange<"string-or-string-list"> = "red",
      multiple: ControlChange<"string-or-string-list", true> = ["red", "blue"],
      // @ts-expect-error a single-select is a scalar; the core rejects a list
      singleAsList: ControlChange<"string-or-string-list"> = ["red"],
      // @ts-expect-error a multiple choice is a list; the core rejects a scalar
      inboundScalar: ControlValue<"string-or-string-list"> = "red",
      multipleAsScalar: ControlChange<"string-or-string-list", true> = "red",
      inboundList: ControlValue<"string-or-string-list"> = ["red"],
      inboundAbsent: ControlValue<"string-or-string-list"> = null;
    expect([single, cleared, multiple, singleAsList, multipleAsScalar]).toHaveLength(5);
    expect([inboundScalar, inboundList, inboundAbsent]).toHaveLength(3);
  });

  it("holds a number answer as a number, never as the text the user typed", () => {
    const value: ControlValue<"number"> = 42,
      // @ts-expect-error the core owns conversion; a control may not smuggle a string through
      text: ControlValue<"number"> = "42";
    expect([value, text]).toHaveLength(2);
  });
});

describe("a mapping key that names no type", () => {
  it("is refused, naming the key", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components, banana: control("banana") };
    expect(() => planComponents({ ...mapping, components })).toThrow();
    expect(() => planComponents({ ...mapping, components })).toThrow(/`banana`/);
  });

  it("says a typo is the likely cause", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components, choise: control("choice") };
    expect(() => planComponents({ ...mapping, components })).toThrow(/almost certainly a typo/);
  });

  it("names every key it does not recognise", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components, apple: control("b"), banana: control("a") };
    // Alphabetical, not the order the object was written in: the report has to
    // Be the same whatever the mapping's key order happens to be.
    expect(() => planComponents({ ...mapping, components })).toThrow(
      /`apple`, `banana`.*name no types/s,
    );
  });

  it("accepts a container the consumer names, because the core declares it", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components, group: control("group") };
    expect(() => planComponents({ ...mapping, components })).not.toThrow();
  });

  it("refuses a key that differs only in case", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components, Text: control("text") };
    expect(() => planComponents({ ...mapping, components })).toThrow(/`Text`/);
  });
});

describe("a mapping that is not complete", () => {
  it("is legal by default, and reports what it left out", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components };
    delete components.choice;
    const { plans, rejected } = planComponents({ ...mapping, components });
    expect(plans.map((plan) => plan.type)).not.toContain("choice");
    expect(rejected.find((entry) => entry.type === "choice")?.kind).toBe("unmapped");
  });

  it("becomes a failure when the consumer refuses one", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components };
    delete components.choice;
    expect(() => planComponents({ ...mapping, components }, { onUnmapped: "refuse" })).toThrow(
      /`choice`.*refuses an incomplete mapping/s,
    );
  });

  it("names every type it left out", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components };
    delete components.choice;
    delete components.time;
    // In the core's own order, not the order the consumer declared them in.
    expect(() => planComponents({ ...mapping, components }, { onUnmapped: "refuse" })).toThrow(
      /`time`, `choice`/,
    );
  });

  it("never counts a container as unmapped", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components };
    delete components.choice;
    expect(() => planComponents({ ...mapping, components }, { onUnmapped: "refuse" })).toThrow(
      /`choice`/,
    );
    expect(() => planComponents({ ...mapping, components }, { onUnmapped: "refuse" })).not.toThrow(
      /`group`/,
    );
  });

  it("passes a complete mapping under the same policy", () => {
    expect(() => planComponents(fullMapping(), { onUnmapped: "refuse" })).not.toThrow();
  });
});

describe(assertCompleteMapping, () => {
  it("passes for a mapping that covers every type", () => {
    expect(() => {
      assertCompleteMapping(fullMapping());
    }).not.toThrow();
  });

  it("fails, naming the type, for one that does not", () => {
    const mapping = fullMapping(),
      components = { ...mapping.components };
    delete components.date;
    expect(() => {
      assertCompleteMapping({ ...mapping, components });
    }).toThrow(/`date`/);
  });
});
