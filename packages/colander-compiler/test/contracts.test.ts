import { describe, expect, it } from "vitest";

import {
  SHELL_CONTROL_SLOT,
  allControlContracts,
  controlContractFor,
  defineControl,
} from "../src/contracts.js";
import type { ControlComponent, ControlProps } from "../src/contracts.js";

/**
 * A control declared here is what a consumer's looks like, and the point of the
 * contract is that this line alone is the check: nothing is generated, and the
 * component's own props are the core's.
 */
function textControl(props: ControlProps<"text">): null {
  void props.minLength;
  void props.pattern;
  return null;
}

function numberControl(props: ControlProps<"number">): null {
  void props.minimum;
  void props.multipleOf;
  void props.decimalPlaces;
  return null;
}

describe("the contract for a type", () => {
  it("names the properties the core declares, and not the shell's two", () => {
    expect(controlContractFor("text")?.properties.map((property) => property.name)).toEqual([
      "minLength",
      "maxLength",
      "pattern",
    ]);
  });

  it("carries the shape of that type's answer", () => {
    expect(controlContractFor("number")?.value).toBe("number");
    expect(controlContractFor("boolean")?.value).toBe("boolean");
  });

  it("carries both shapes for a choice, because `allowMultiple` decides between them", () => {
    // Not a rounding of the line above: the core's `convert_single_choice` takes
    // `Json::as_str` and `convert_multi_choice` takes `Json::Array`, each
    // Rejecting the other's shape, and `allowMultiple` is a *field* property. A
    // Contract that said one shape would be wrong for half the choices it covers.
    expect(controlContractFor("choice")?.value).toBe("string-or-string-list");
  });

  it("covers every type the core can materialize, and nothing else", () => {
    expect(allControlContracts().map((contract) => contract.type)).toEqual([
      "text",
      "textarea",
      "number",
      "integer",
      "boolean",
      "date",
      "datetime",
      "time",
      "choice",
    ]);
  });

  it("has no contract for a container, or for a name the core does not declare", () => {
    expect(controlContractFor("group")).toBeNull();
    expect(controlContractFor("repeater")).toBeNull();
    expect(controlContractFor("banana")).toBeNull();
  });

  it("names a type's properties in the core's own order", () => {
    expect(controlContractFor("number")?.properties.map((property) => property.name)).toEqual([
      "minimum",
      "maximum",
      "multipleOf",
      "decimalPlaces",
    ]);
  });
});

describe(defineControl, () => {
  it("takes a control that meets the contract, and returns it", () => {
    expect(defineControl("text", textControl)).toBe(textControl);
    expect(defineControl("number", numberControl)).toBe(numberControl);
  });

  it("refuses at runtime a type the core does not materialize", () => {
    expect(() => defineControl("group" as never, (() => null) as never)).toThrow(
      /not a type the core materializes/,
    );
  });
});

describe("the contract a component is written against", () => {
  it("holds the core's context, so a control needs no props interface of its own", () => {
    const control: ControlComponent<"choice"> = (props) => {
      void props.id;
      void props.code;
      void props.value;
      void props.onChange;
      void props.disabled;
      void props.readOnly;
      void props.required;
      void props.options;
      void props.allowMultiple;
      return null;
    };
    expect(control).toBeDefined();
  });

  it("does not hold the shell's half, because the shell renders those", () => {
    const control: ControlComponent<"text"> = (props) => {
      // @ts-expect-error a control is not handed the label; the shell draws it
      const wrong: string = props.label;
      void wrong;
      return null;
    };
    expect(control).toBeDefined();
  });

  it("types a choice's answer as the list the core publishes, not a string", () => {
    const control: ControlComponent<"choice"> = (props) => {
      // @ts-expect-error a choice's answer is a list, so a bare string is not it
      const wrong: string = props.value;
      void wrong;
      return null;
    };
    expect(control).toBeDefined();
  });

  it("types a number's answer as a number, so a control cannot smuggle a string", () => {
    const control: ControlComponent<"number"> = (props) => {
      // @ts-expect-error the core owns conversion; a number control receives a number
      const wrong: string = props.value;
      void wrong;
      return null;
    };
    expect(control).toBeDefined();
  });

  it("has no semantic property on a boolean, because the core declares none", () => {
    const control: ControlComponent<"boolean"> = (props) => {
      // @ts-expect-error a boolean field declares no pattern
      const wrong: string | undefined = props.pattern;
      void wrong;
      return null;
    };
    expect(control).toBeDefined();
  });

  it("refuses a control that demands a property the core never declares for its type", () => {
    function wrong(props: ControlProps<"date"> & { readonly pattern: string }): null {
      void props.pattern;
      return null;
    }
    // @ts-expect-error `pattern` is not part of a date control's contract
    const refused: ControlComponent<"date"> = wrong;
    expect(refused).toBeDefined();
  });
});

describe("what a written shell has to contain", () => {
  it("is one named slot", () => {
    expect(SHELL_CONTROL_SLOT).toBe("{control}");
  });
});
