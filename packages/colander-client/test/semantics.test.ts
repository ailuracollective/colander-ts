import { describe, expect, it } from "vitest";

import {
  CONTAINER_FIELD_TYPES,
  FIELD_PROPERTY_KEYS,
  SEMANTIC_TYPE_DESCRIPTORS,
  materializableTypes,
  semanticDescriptorFor,
} from "../src/semantics.js";
import type { SemanticProperty } from "../src/semantics.js";
import { COLANDER_FIELD_TYPES } from "../src/types.js";

/**
 * The keys `Field` declares for a control's constraints, written out here rather
 * than imported, so a property the table names that the wire type does not
 * declare fails a test that names it instead of failing a type assertion nobody
 * reads.
 */
const DECLARED_FIELD_KEYS = [
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "multipleOf",
  "decimalPlaces",
  "allowMultiple",
  "minItems",
  "maxItems",
  "title",
  "description",
] as const;

describe(SEMANTIC_TYPE_DESCRIPTORS, () => {
  it("describes every type the core vocabulary declares, once and in order", () => {
    expect(SEMANTIC_TYPE_DESCRIPTORS.map((descriptor) => descriptor.type)).toEqual([
      ...COLANDER_FIELD_TYPES,
    ]);
  });

  it("carries only keys the wire Field type declares", () => {
    for (const descriptor of SEMANTIC_TYPE_DESCRIPTORS) {
      for (const property of descriptor.properties) {
        expect(
          DECLARED_FIELD_KEYS,
          `${descriptor.type}.${property.name} is not a declared Field key`,
        ).toContain(property.name);
      }
    }
  });

  it("names no property twice within one type", () => {
    for (const descriptor of SEMANTIC_TYPE_DESCRIPTORS) {
      const names = descriptor.properties.map((property) => property.name);
      expect(new Set(names).size, `${descriptor.type} repeats a property`).toBe(names.length);
    }
  });

  it("carries title and description as strings for every type", () => {
    for (const descriptor of SEMANTIC_TYPE_DESCRIPTORS) {
      const carried: Record<string, string> = Object.fromEntries(
        descriptor.properties.map((property) => [property.name, property.type]),
      );
      expect(carried.title, `${descriptor.type} title`).toBe("string");
      expect(carried.description, `${descriptor.type} description`).toBe("string");
    }
  });

  it("declares every property key it is allowed to use", () => {
    const used = new Set(
      SEMANTIC_TYPE_DESCRIPTORS.flatMap((descriptor) =>
        descriptor.properties.map((property) => property.name),
      ),
    );
    for (const key of FIELD_PROPERTY_KEYS) {
      expect(used.has(key), `${key} is declared as a key but no type carries it`).toBe(true);
    }
  });

  it("does not mark a container as materializable", () => {
    for (const descriptor of SEMANTIC_TYPE_DESCRIPTORS) {
      const isContainer = (CONTAINER_FIELD_TYPES as readonly string[]).includes(descriptor.type);
      expect(descriptor.materializable, `${descriptor.type} materializable`).toBe(!isContainer);
    }
  });

  it("is readable at build time without narrowing", () => {
    const text = SEMANTIC_TYPE_DESCRIPTORS[0],
      properties: readonly SemanticProperty[] = text?.properties ?? [];
    expect(properties.length).toBeGreaterThan(0);
  });
});

describe(semanticDescriptorFor, () => {
  it("returns the descriptor of a known type", () => {
    expect(semanticDescriptorFor("text")?.value).toBe("string");
    expect(semanticDescriptorFor("boolean")?.value).toBe("boolean");
  });

  it("declares a choice's value as both shapes, because the type cannot say which", () => {
    // The core decides a choice's answer shape per *field*, from `allowMultiple`,
    // And strictly in both directions: `convert_single_choice` takes
    // `Json::as_str` and rejects a list, `convert_multi_choice` takes
    // `Json::Array` and rejects a scalar. A descriptor that said `"string-list"`
    // Was therefore claiming the core accepts a list for every choice, which is
    // False for the single-select case the type is most often used for — and that
    // Claim is what made the compiler's `choice` control answer a dropdown with
    // `["red"]`.
    const choice = semanticDescriptorFor("choice");
    expect(choice?.value).toBe("string-or-string-list");
    expect(choice?.shapeFromProperty).toBe("allowMultiple");
  });

  it("names no shape-deciding property for a type whose shape follows from its type", () => {
    // The flag is what a control reads to narrow. A type that does not carry it
    // Must say so by its absence, or every control would have to test a property
    // The core does not declare for it.
    for (const type of ["text", "number", "boolean", "date"] as const) {
      expect(semanticDescriptorFor(type)?.shapeFromProperty).toBeUndefined();
    }
  });

  it("matches the type exactly and case-sensitively", () => {
    expect(semanticDescriptorFor("Text")).toBeNull();
    expect(semanticDescriptorFor("TEXT")).toBeNull();
    expect(semanticDescriptorFor("")).toBeNull();
    expect(semanticDescriptorFor("unknown")).toBeNull();
  });
});

describe(materializableTypes, () => {
  it("returns every type that is not a container, in core order", () => {
    expect(materializableTypes()).toEqual([
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

  it("excludes exactly the container types", () => {
    const materializable = new Set<string>(materializableTypes());
    for (const type of CONTAINER_FIELD_TYPES) {
      expect(materializable.has(type), `${type} must not be materializable`).toBe(false);
    }
  });
});
