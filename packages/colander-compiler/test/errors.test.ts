import { describe, expect, it } from "vitest";

import { ColanderCompilerError, mappingError } from "../src/errors.js";

const SHELL = { export: "default", module: "@/s" } as const;

describe("one error, with the distinction kept as a field", () => {
  it("carries which part refused", () => {
    expect(mappingError("the `text` control", "because").kind).toBe("mapping");
    expect(new ColanderCompilerError("template", "because").kind).toBe("template");
    expect(new ColanderCompilerError("config", "because").kind).toBe("config");
  });

  it("names the subject and the path when there is one", () => {
    expect(mappingError("the field shell", "because").subject).toBe("the field shell");
    expect(new ColanderCompilerError("config", "because", { path: "/c.ts" }).path).toBe("/c.ts");
    expect(mappingError("x", "because").path).toBeUndefined();
  });

  it("reads as a sentence a developer can act on", () => {
    expect(mappingError("the `text` control", "it names no type").message).toBe(
      "The component mapping for the `text` control is not usable: it names no type",
    );
    expect(new ColanderCompilerError("config", "it could not be read").message).toBe(
      "it could not be read",
    );
  });

  it("is a real Error, for a caller that only catches that", () => {
    expect(mappingError("x", "because")).toBeInstanceOf(Error);
    expect(mappingError("x", "because")).toBeInstanceOf(ColanderCompilerError);
  });
});

describe("every refusal is that one error", () => {
  it("covers a mapping problem", async () => {
    const { planComponents } = await import("../src/plan.js"),
      attempt = () => planComponents({ components: { banana: SHELL } as never, shell: SHELL });
    expect(attempt).toThrow(ColanderCompilerError);
  });

  it("covers a missing shell", async () => {
    const { planComponents } = await import("../src/plan.js"),
      attempt = () => planComponents({ components: {} } as never);
    expect(attempt).toThrow(/the field shell is not usable/);
  });
});
