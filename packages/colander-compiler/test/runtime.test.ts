import { describe, expect, it, vi } from "vitest";

import { controlPropsFor, renderColanderField } from "../src/runtime.js";
import type { ColanderBinding } from "../src/runtime.js";

/**
 * What used to be generated, now provided by the package.
 *
 * A leaf's type is a value, so the pair of control and property reader can only be
 * made at runtime; that pairing is the whole of what the generated tree was for.
 */
const field = { code: "age", minLength: 3, pattern: "x", type: "number" } as never,
  binding: ColanderBinding = {
    code: "age",
    description: "in years",
    disabled: false,
    errors: ["too small"],
    field,
    id: "colander-age",
    label: "Age",
    onChange: () => {},
    options: [],
    readOnly: false,
    required: true,
    type: "number",
    value: 42,
  };

describe(controlPropsFor, () => {
  it("reads the properties the core declares for that type", () => {
    expect(controlPropsFor("text", field)).toEqual({ minLength: 3, pattern: "x" });
  });

  it("never reads a property the shell renders, so a control cannot draw a label", () => {
    const props = controlPropsFor("text", field);
    expect(props).not.toHaveProperty("label");
    expect(props).not.toHaveProperty("title");
    expect(props).not.toHaveProperty("description");
  });

  it("reports a property the document did not declare as absent, not as a value", () => {
    expect(controlPropsFor("number", { type: "number" })).toEqual({
      decimalPlaces: undefined,
      maximum: undefined,
      minimum: undefined,
      multipleOf: undefined,
    });
  });
});

describe(renderColanderField, () => {
  it("hands the control the core's context, the answer and its own properties", () => {
    const control = vi.fn((_props: Record<string, unknown>) => null),
      element = renderColanderField({ number: control as never }, binding) as {
        props: Record<string, unknown>;
      },
      { props } = element;
    expect(props.id).toBe("colander-age");
    expect(props.code).toBe("age");
    expect(props.value).toBe(42);
    expect(props.required).toBe(true);
    expect(props.minimum).toBeUndefined();
    // A control is not handed the label: the shell draws it.
    expect(props).not.toHaveProperty("label");
  });

  it("wraps the control in the shell, which is given the text and the messages", () => {
    const shell = vi.fn((_props: Record<string, unknown>, _children: unknown) => null);
    renderColanderField({ number: (() => null) as never }, binding, shell as never);
    const props = shell.mock.calls[0]?.[0] ?? {};
    expect(props.label).toBe("Age");
    expect(props.description).toBe("in years");
    expect(props.errors).toEqual(["too small"]);
  });

  it("renders nothing, rather than an empty box, for a type it has no control for", () => {
    expect(renderColanderField({}, binding)).toBeNull();
  });
});
