import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isKnownFieldType } from "@ailura/colander-client";
import { describe, expect, it } from "vitest";

import {
  addField,
  canReceiveChild,
  componentTargetFor,
  editablePropertiesFor,
  EditorModelError,
  fieldIds,
  getComponentRefProperty,
  getNodeProperty,
  isContainerFieldType,
  isEditableProperty,
  isEditorFieldType,
  isMaterializableFieldType,
  moveNode,
  nodeById,
  parseDocuments,
  removeNode,
  rulesEntryFor,
  serialiseDocuments,
  setComponentRefProperty,
  setNodeProperty,
  fieldRuleProblems,
  fieldRulesFor,
  getFieldRule,
  orphanedRuleFields,
  knownCodeSet,
  setFieldRule,
  subtreeIds,
  uiEntryFor,
  COMPONENT_REF_PROPERTIES,
  CONTAINER_FIELD_TYPES,
  EDITABLE_PROPERTIES,
  EDITOR_FIELD_TYPES,
  MATERIALIZABLE_FIELD_TYPES,
  type DocumentModel,
  type EditableProperty,
  type EditorFieldType,
  type EditorNode,
} from "./document-model";

/**
 * The real documents under test.
 *
 * The fixtures are the nest-app's, loaded from disk rather than re-typed, and
 * the form and rules halves are turned into documents the way the API does: a
 * JSON **text** string per document. The fixtures on disk are pretty-printed,
 * and a pretty-printed text cannot be reproduced byte for byte by
 * `JSON.stringify`, so the document text is the fixture's own value serialised
 * once. That text is the exact input the model is given, which is what a
 * round trip has to return.
 */
function readFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../../../nest-app/test/fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

interface BmiFixture {
  readonly form: { readonly schemaVersion: string; readonly fields: readonly unknown[] };
  readonly rules: Record<string, unknown>;
}

const bmi = readFixture("bmi-calculation.json") as unknown as BmiFixture;
const bloodPressure = readFixture("bp-cross-field.json") as unknown as BmiFixture;

function bmiSource(): {
  formSchemaJson: string;
  uiSchemaJson: string | null;
  rulesSchemaJson: string | null;
} {
  return {
    formSchemaJson: JSON.stringify(bmi.form),
    uiSchemaJson: null,
    rulesSchemaJson: JSON.stringify(bmi.rules),
  };
}

function bmiModel(): DocumentModel {
  return parseDocuments(bmiSource());
}

/** A document built around the bmi fields, plus one nested container. */
function nestedModel(): DocumentModel {
  const form = {
    schemaVersion: "1.0.0",
    fields: [
      { id: "group-a", code: "a", type: "group" },
      { id: "repeater-r", code: "r", type: "repeater", minItems: 1 },
      { id: "leaf-top", code: "top", type: "text" },
    ],
  };
  const model = parseDocuments({ formSchemaJson: JSON.stringify(form) });
  const groupA = nodeById(model, "group-a");
  expect(groupA).not.toBeNull();
  if (groupA === null) {
    throw new Error("unreachable");
  }
  addField(model, "group", "group-a", { id: "group-b", code: "b" });
  addField(model, "text", "group-a", { id: "leaf-in-a", code: "in-a" });
  addField(model, "text", "group-b", { id: "leaf-in-b", code: "in-b" });
  addField(model, "text", "repeater-r", { id: "leaf-in-r", code: "in-r" });
  return model;
}

describe("parse and serialise", () => {
  it("round-trips a real fixture byte for byte", () => {
    const source = bmiSource();
    const model = parseDocuments(source);
    const saved = serialiseDocuments(model);

    expect(saved.formSchemaJson).toBe(source.formSchemaJson);
    expect(saved.rulesSchemaJson).toBe(source.rulesSchemaJson);
    // A version with no ui document stays without one: absence is not `{}`.
    expect(saved.uiSchemaJson).toBeNull();
  });

  it("round-trips the blood-pressure fixture and its validations", () => {
    const source = {
      formSchemaJson: JSON.stringify(bloodPressure.form),
      rulesSchemaJson: JSON.stringify(bloodPressure.rules),
    };
    const model = parseDocuments(source);
    const saved = serialiseDocuments(model);

    expect(saved.formSchemaJson).toBe(source.formSchemaJson);
    expect(saved.rulesSchemaJson).toBe(source.rulesSchemaJson);
    expect(Object.keys(rulesEntryFor(model, "systolic") ?? {})).toHaveLength(0);
  });

  it("round-trips unknown keys at every level byte for byte", () => {
    const form = {
      schemaVersion: "1.0.0",
      "x-form-extension": { vendor: "unknown", level: 2 },
      fields: [
        {
          id: "weight-kg",
          code: "body.weight.kg",
          type: "number",
          "x-field-extension": "kept",
          minimum: 10,
        },
        {
          id: "group",
          code: "g",
          type: "group",
          "x-group-extension": [1, 2, 3],
          items: [
            {
              id: "nested",
              code: "g.nested",
              type: "text",
              "x-nested-extension": { deep: true },
            },
          ],
        },
      ],
    };
    const ui = {
      schemaVersion: "1.0.0",
      "x-ui-extension": "kept",
      fields: { "weight-kg": { hidden: false, "x-ui-field": "kept" } },
      layout: [{ type: "group", id: "g", "x-layout-extension": 7 }],
    };
    const rules = {
      schemaVersion: "1.0.0",
      "x-rules-extension": "kept",
      fields: { "weight-kg": { "x-rule-extension": true, visibleWhen: { ref: "g.nested" } } },
    };
    const source = {
      formSchemaJson: JSON.stringify(form),
      uiSchemaJson: JSON.stringify(ui),
      rulesSchemaJson: JSON.stringify(rules),
    };

    const saved = serialiseDocuments(parseDocuments(source));

    expect(saved.formSchemaJson).toBe(source.formSchemaJson);
    expect(saved.uiSchemaJson).toBe(source.uiSchemaJson);
    expect(saved.rulesSchemaJson).toBe(source.rulesSchemaJson);
  });

  it("keeps an unknown key when an edit touches a sibling key", () => {
    const source = {
      formSchemaJson: JSON.stringify({
        schemaVersion: "1.0.0",
        "x-form-extension": "kept",
        fields: [
          {
            id: "bmi",
            code: "body.bmi",
            type: "number",
            "x-field-extension": "kept",
            readOnly: true,
            multipleOf: 0.01,
          },
        ],
      }),
    };
    const model = parseDocuments(source);
    const bmiNode = nodeById(model, "bmi");
    expect(bmiNode).not.toBeNull();
    if (bmiNode === null) {
      throw new Error("unreachable");
    }
    setNodeProperty(bmiNode, "title", "Body mass index");

    const saved = serialiseDocuments(model);
    expect(saved.formSchemaJson).toBe(
      JSON.stringify({
        schemaVersion: "1.0.0",
        "x-form-extension": "kept",
        fields: [
          {
            id: "bmi",
            code: "body.bmi",
            type: "number",
            "x-field-extension": "kept",
            readOnly: true,
            multipleOf: 0.01,
            title: "Body mass index",
          },
        ],
      }),
    );
  });

  it("serialises once: the stored text is the only text the model produces", () => {
    const source = bmiSource();
    const model = parseDocuments(source);
    const node = nodeById(model, "weight-kg");
    expect(node).not.toBeNull();
    if (node === null) {
      throw new Error("unreachable");
    }
    setNodeProperty(node, "title", "Weight in kilograms");

    // One serialisation, and it carries the edit.
    const saved = serialiseDocuments(model);
    expect(saved.formSchemaJson).toBe(
      JSON.stringify({
        schemaVersion: "1.0.0",
        fields: [
          { id: "weight-kg", code: "body.weight.kg", type: "number", title: "Weight in kilograms" },
          { id: "height-m", code: "body.height.m", type: "number" },
          { id: "bmi", code: "body.bmi", type: "number", readOnly: true, multipleOf: 0.01 },
        ],
      }),
    );

    // Nothing else moved: every other field, the key order and the rules
    // document are exactly what was loaded.
    const reloaded = parseDocuments(saved);
    expect(fieldIds(reloaded)).toEqual(["weight-kg", "height-m", "bmi"]);
    expect(reloaded.root[1]?.raw).toEqual({
      id: "height-m",
      code: "body.height.m",
      type: "number",
    });
    expect(saved.rulesSchemaJson).toBe(source.rulesSchemaJson);

    // Serialising again is a projection of the same model, not a second edit.
    expect(serialiseDocuments(model)).toEqual(saved);
  });
});

describe("the closed type list", () => {
  it("holds exactly nine materialisable types and three containers", () => {
    expect(MATERIALIZABLE_FIELD_TYPES).toEqual([
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
    expect(CONTAINER_FIELD_TYPES).toEqual(["group", "repeater", "component-ref"]);
    expect(EDITOR_FIELD_TYPES).toHaveLength(12);
    expect(new Set(EDITOR_FIELD_TYPES).size).toBe(12);
  });

  it("separates a materialisable type from a container", () => {
    for (const type of MATERIALIZABLE_FIELD_TYPES) {
      expect(isMaterializableFieldType(type)).toBe(true);
      expect(isContainerFieldType(type)).toBe(false);
    }
    for (const type of CONTAINER_FIELD_TYPES) {
      expect(isContainerFieldType(type)).toBe(true);
      expect(isMaterializableFieldType(type)).toBe(false);
    }
    expect(isEditorFieldType("money")).toBe(false);
    expect(isEditorFieldType("Text")).toBe(false);
  });

  it("refuses a tenth type instead of inventing one", () => {
    const model = bmiModel();
    expect(() => addField(model, "money")).toThrowError(EditorModelError);
    try {
      addField(model, "money");
      expect.unreachable("a tenth type must be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(EditorModelError);
      expect((error as EditorModelError).code).toBe("UNKNOWN_FIELD_TYPE");
    }
  });
});

describe("adding a field", () => {
  it("adds each of the nine leaf types in a shape the core's field list accepts", () => {
    for (const type of MATERIALIZABLE_FIELD_TYPES) {
      const model = bmiModel();
      const added = addField(model, type, null, { label: `Sample ${type}` });

      expect(isKnownFieldType(added.type)).toBe(true);
      expect(isMaterializableFieldType(added.type)).toBe(true);
      expect(added.code).toBe(`sample-${type}`);
      expect(model.nodesById.has(added.id)).toBe(true);

      const saved = serialiseDocuments(model);
      const reloaded = parseDocuments(saved);
      const reloadedNode = nodeById(reloaded, added.id);
      expect(reloadedNode).not.toBeNull();
      if (reloadedNode === null) {
        throw new Error("unreachable");
      }
      // The client's own `Field` shape: a type, an id and a code, and nothing
      // that would make the core reject it.
      expect(reloadedNode.field.type).toBe(type);
      expect(reloadedNode.field.id).toBe(added.id);
      expect(reloadedNode.field.code).toBe(added.code);
      expect(reloadedNode.children).toEqual([]);
    }
  });

  it("gives every added field a unique id and a unique code", () => {
    const model = bmiModel();
    const ids: string[] = [];
    const codes: string[] = [];
    for (const type of MATERIALIZABLE_FIELD_TYPES) {
      const added = addField(model, type, null, { label: "Same label" });
      ids.push(added.id);
      codes.push(added.code);
    }
    expect(new Set(ids).size).toBe(9);
    expect(new Set(codes).size).toBe(9);
    const existing = model.nodesById.get("bmi");
    expect(existing).toBeDefined();
    expect(codes).not.toContain("body.bmi");
  });

  it("refuses a code that would overwrite an existing one", () => {
    const model = bmiModel();
    expect(() => addField(model, "text", null, { code: "body.bmi" })).toThrowError(
      EditorModelError,
    );
    try {
      addField(model, "text", null, { code: "body.bmi" });
      expect.unreachable("an existing code must not be overwritten");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("DUPLICATE_CODE");
    }
    expect(model.nodesById.size).toBe(3);
  });
});

describe("a component reference names a component", () => {
  /** The shape the canonical samples use for a component reference. */
  const COMPONENT_SAMPLE_FORM = {
    schemaVersion: "1.0.0",
    fields: [
      {
        id: "shipping-address",
        code: "shipping.address",
        type: "component-ref",
        componentCode: "address-card",
        componentVersion: "1.0.0",
        title: "Shipping address",
        "x-field-extension": "kept",
      },
    ],
  };

  it("keeps componentCode and componentVersion out of the control table", () => {
    expect(COMPONENT_REF_PROPERTIES).toEqual(["componentCode", "componentVersion"]);
    for (const type of EDITOR_FIELD_TYPES) {
      expect(editablePropertiesFor(type)).not.toContain("componentCode");
      expect(editablePropertiesFor(type)).not.toContain("componentVersion");
    }
    // A component reference's row is still the control table's row: a
    // component reference is drawn by the tree, not by a control.
    expect(editablePropertiesFor("component-ref")).toEqual([
      "title",
      "description",
      "required",
      "readOnly",
    ]);
  });

  it("round-trips both keys byte for byte alongside unknown keys", () => {
    const form = {
      schemaVersion: "1.0.0",
      "x-form-extension": "kept",
      fields: [
        {
          ...COMPONENT_SAMPLE_FORM.fields[0],
          "x-nested-extension": { deep: true },
        },
      ],
    };
    const ui = {
      schemaVersion: "1.0.0",
      "x-ui-extension": "kept",
      fields: { "shipping-address": { "x-ui-field": "kept" } },
    };
    const source = {
      formSchemaJson: JSON.stringify(form),
      uiSchemaJson: JSON.stringify(ui),
      rulesSchemaJson: null,
    };

    const model = parseDocuments(source);
    const node = nodeById(model, "shipping-address");
    if (node === null) {
      throw new Error("unreachable");
    }
    expect(getComponentRefProperty(node, "componentCode")).toBe("address-card");
    expect(getComponentRefProperty(node, "componentVersion")).toBe("1.0.0");
    expect(componentTargetFor(node)).toEqual({
      componentCode: "address-card",
      componentVersion: "1.0.0",
    });

    const saved = serialiseDocuments(model);
    expect(saved.formSchemaJson).toBe(source.formSchemaJson);
    expect(saved.uiSchemaJson).toBe(source.uiSchemaJson);
  });

  it("adds a component reference that names its component", () => {
    const model = bmiModel();
    const added = addField(model, "component-ref", null, {
      label: "Applicant context",
      component: { componentCode: "casework-context", componentVersion: "1.0.0" },
    });

    expect(added.code).toBe("applicant-context");
    expect(componentTargetFor(added)).toEqual({
      componentCode: "casework-context",
      componentVersion: "1.0.0",
    });
    // The same key order as the canonical sample in src/samples.ts.
    const saved = serialiseDocuments(model);
    const form = JSON.parse(saved.formSchemaJson) as { fields: Record<string, unknown>[] };
    expect(form.fields[3]).toEqual({
      id: "applicant-context",
      code: "applicant-context",
      type: "component-ref",
      componentCode: "casework-context",
      componentVersion: "1.0.0",
      title: "Applicant context",
    });
  });

  it("refuses a component reference that names nothing", () => {
    const model = bmiModel();
    for (const options of [{}, { label: "No component" }, { component: { componentCode: "" } }]) {
      try {
        addField(model, "component-ref", null, options);
        expect.unreachable("a component reference with no component cannot compile");
      } catch (error) {
        expect(error).toBeInstanceOf(EditorModelError);
        expect((error as EditorModelError).code).toBe("MISSING_COMPONENT_REFERENCE");
      }
    }
    // Nothing was added, and the stored text is what was loaded.
    expect(model.nodesById.size).toBe(3);
    expect(serialiseDocuments(model).formSchemaJson).toBe(bmiSource().formSchemaJson);
  });

  it("refuses a component on a type that is not a component reference", () => {
    const model = bmiModel();
    try {
      addField(model, "text", null, { component: { componentCode: "address-card" } });
      expect.unreachable("a text field has no componentCode to set");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("PROPERTY_NOT_EDITABLE");
    }
    expect(model.nodesById.size).toBe(3);
  });

  it("refuses a componentCode on a type that is not a component reference", () => {
    const model = bmiModel();
    const node = nodeById(model, "bmi");
    if (node === null) {
      throw new Error("unreachable");
    }
    try {
      setComponentRefProperty(node, "componentCode", "address-card");
      expect.unreachable("a number is not a component reference");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("PROPERTY_NOT_EDITABLE");
      expect((error as EditorModelError).fieldId).toBe("bmi");
    }
    expect(() => getComponentRefProperty(node, "componentCode")).toThrowError(EditorModelError);
    expect(node.raw["componentCode"]).toBeUndefined();
    expect(componentTargetFor(node)).toBeNull();
  });

  it("refuses an empty or non-string componentCode", () => {
    const model = bmiModel();
    const added = addField(model, "component-ref", null, {
      component: { componentCode: "address-card", componentVersion: "1.0.0" },
    });
    for (const value of ["", "   "]) {
      try {
        setComponentRefProperty(added, "componentCode", value);
        expect.unreachable("an empty componentCode names no component");
      } catch (error) {
        expect((error as EditorModelError).code).toBe("INVALID_PROPERTY_VALUE");
      }
    }
    expect(getComponentRefProperty(added, "componentCode")).toBe("address-card");

    setComponentRefProperty(added, "componentCode", "other-card");
    setComponentRefProperty(added, "componentVersion", "2.0.0");
    expect(componentTargetFor(added)).toEqual({
      componentCode: "other-card",
      componentVersion: "2.0.0",
    });
  });

  it("loads a stored component reference that names no component, unchanged", () => {
    // Parsing is permissive: refusing here would be the editor refusing to
    // open a version. The refusal belongs to an add, not to a load.
    const source = {
      formSchemaJson: JSON.stringify({
        fields: [{ id: "ref", code: "r", type: "component-ref" }],
      }),
    };
    const model = parseDocuments(source);
    const node = nodeById(model, "ref");
    if (node === null) {
      throw new Error("unreachable");
    }
    expect(componentTargetFor(node)).toBeNull();
    expect(serialiseDocuments(model).formSchemaJson).toBe(source.formSchemaJson);
  });
});

describe("containers", () => {
  it("produces children the model can address", () => {
    const model = nestedModel();
    const groupA = nodeById(model, "group-a");
    const groupB = nodeById(model, "group-b");
    expect(groupA?.children.map((child) => child.id)).toEqual(["group-b", "leaf-in-a"]);
    expect(groupB?.parent?.id).toBe("group-a");
    expect(nodeById(model, "leaf-in-b")?.parent?.id).toBe("group-b");

    const saved = serialiseDocuments(model);
    const form = JSON.parse(saved.formSchemaJson) as {
      fields: { id: string; items?: { id: string }[] }[];
    };
    const groupAJson = form.fields.find((entry) => entry.id === "group-a");
    expect(groupAJson?.items?.map((entry) => entry.id)).toEqual(["group-b", "leaf-in-a"]);
  });

  it("refuses a container under a repeater, because a row has no container", () => {
    const model = nestedModel();
    for (const type of CONTAINER_FIELD_TYPES) {
      try {
        addField(model, type, "repeater-r");
        expect.unreachable("a repeater takes per-row answer fields only");
      } catch (error) {
        expect(error).toBeInstanceOf(EditorModelError);
        expect((error as EditorModelError).code).toBe("ILLEGAL_PLACEMENT");
      }
    }
    expect(nodeById(model, "repeater-r")?.children.map((child) => child.id)).toEqual(["leaf-in-r"]);
  });

  it("refuses a container under a component reference, which would expand forever", () => {
    const model = parseDocuments({
      formSchemaJson: JSON.stringify({ fields: [{ id: "ref", code: "r", type: "component-ref" }] }),
    });
    try {
      addField(model, "component-ref", "ref");
      expect.unreachable("a component reference may not contain one");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("ILLEGAL_PLACEMENT");
    }
  });

  it("refuses anything under a leaf, because a leaf is a field and not a container", () => {
    const model = bmiModel();
    try {
      addField(model, "text", "bmi");
      expect.unreachable("nothing goes inside a leaf");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("ILLEGAL_PLACEMENT");
    }
  });
});

describe("canReceiveChild, the question the mutations answer by refusing", () => {
  // The predicate exists so that a layer which has to decide where to *aim* —
  // the drag layer — can ask the model instead of holding a second copy of the
  // rules. Every case below therefore has a second half: the answer the
  // predicate gives, and what `addField` does with the same pair. A predicate
  // that answered "yes" to something `addField` refuses would make the editor
  // aim at a position the model always says no to, which is the defect it was
  // added to remove.
  function accepted(model: DocumentModel, parentId: string, type: string): boolean {
    // A `component-ref` is created with the component it names, or not at all --
    // so the add below carries one, and the only refusal left to observe is the
    // placement this predicate is about.
    const component = type === "component-ref" ? { componentCode: "card" } : undefined;
    try {
      addField(model, type, parentId, component === undefined ? {} : { component });
      return true;
    } catch (error) {
      expect(error, `${type} under ${parentId}`).toBeInstanceOf(EditorModelError);
      expect((error as EditorModelError).code, `${type} under ${parentId}`).toBe(
        "ILLEGAL_PLACEMENT",
      );
      return false;
    }
  }

  it("refuses a leaf, for every type there is", () => {
    // The box of a leaf is mostly its own controls, so the middle band is the
    // *dominant* aim at one: the answer here is what stops the editor from
    // sending every drag over a field into a node that can hold nothing.
    const model = bmiModel();
    for (const type of EDITOR_FIELD_TYPES) {
      expect(canReceiveChild(model, "bmi", type), `${type} under a leaf`).toBe(false);
    }
  });

  it("accepts an empty repeater, with or without a minItems", () => {
    // The case a `children.length` check gets wrong. A repeater that was just
    // added holds nothing and is still the node somebody wants to drag a field
    // into, so "it has no children yet" cannot be the test.
    const withNone = parseDocuments({
      formSchemaJson: JSON.stringify({ fields: [{ id: "r", code: "r", type: "repeater" }] }),
    });
    const withZero = parseDocuments({
      formSchemaJson: JSON.stringify({
        fields: [{ id: "r", code: "r", type: "repeater", minItems: 0 }],
      }),
    });
    expect(nodeById(withNone, "r")?.children).toEqual([]);
    expect(nodeById(withZero, "r")?.children).toEqual([]);
    expect(canReceiveChild(withNone, "r", "text")).toBe(true);
    expect(canReceiveChild(withZero, "r", "text")).toBe(true);
    // And the model agrees, which is the only thing that makes the answer
    // worth having.
    expect(accepted(withNone, "r", "text")).toBe(true);
    expect(accepted(withZero, "r", "text")).toBe(true);
  });

  it("accepts a repeater that has rows, for a per-row answer field", () => {
    const model = nestedModel();
    expect(canReceiveChild(model, "repeater-r", "text")).toBe(true);
    expect(accepted(model, "repeater-r", "text")).toBe(true);
    // A row is an answer field and not a container, so a group still cannot go
    // there — the rule is beside the acceptance, not part of it.
    expect(canReceiveChild(model, "repeater-r", "group")).toBe(false);
    expect(accepted(model, "repeater-r", "group")).toBe(false);
  });

  it("refuses a component reference that would contain a component reference", () => {
    const model = parseDocuments({
      formSchemaJson: JSON.stringify({
        fields: [{ id: "ref", code: "ref", type: "component-ref", componentCode: "card" }],
      }),
    });
    expect(canReceiveChild(model, "ref", "component-ref")).toBe(false);
    expect(accepted(model, "ref", "component-ref")).toBe(false);
    // The same reference takes a leaf and a group: the rule is about the
    // reference, not about the reference being empty.
    expect(canReceiveChild(model, "ref", "text")).toBe(true);
    expect(canReceiveChild(model, "ref", "group")).toBe(true);
  });

  it("refuses everything when the node is not in the document", () => {
    // There is no node to hold anything, and an id the document does not have
    // is not a container that happens to be empty.
    const model = bmiModel();
    for (const type of EDITOR_FIELD_TYPES) {
      expect(canReceiveChild(model, "no-such-node", type)).toBe(false);
    }
  });

  it("agrees with addField on every pair in the document, in both directions", () => {
    // The whole point of delegating: over the fixture, the predicate and the
    // mutation never disagree. A model that reparses per case, because a
    // refused add leaves nothing behind.
    const model = nestedModel();
    const parents = ["group-a", "group-b", "repeater-r", "leaf-in-r", "leaf-top"];
    for (const parentId of parents) {
      for (const type of EDITOR_FIELD_TYPES) {
        const asked = canReceiveChild(model, parentId, type);
        const fresh = parseDocuments({ formSchemaJson: serialiseDocuments(model).formSchemaJson });
        expect(asked, `${type} under ${parentId}`).toBe(accepted(fresh, parentId, type));
      }
    }
  });
});

describe("removing a node", () => {
  it("removes the whole subtree", () => {
    const model = nestedModel();
    removeNode(model, "group-a");

    expect(nodeById(model, "group-a")).toBeNull();
    expect(nodeById(model, "group-b")).toBeNull();
    expect(nodeById(model, "leaf-in-a")).toBeNull();
    expect(nodeById(model, "leaf-in-b")).toBeNull();
    expect(fieldIds(model)).toEqual(["repeater-r", "leaf-in-r", "leaf-top"]);

    const saved = serialiseDocuments(model);
    expect(saved.formSchemaJson).not.toContain("group-a");
    expect(saved.formSchemaJson).not.toContain("leaf-in-b");
    expect(fieldIds(parseDocuments(saved))).toEqual(["repeater-r", "leaf-in-r", "leaf-top"]);
  });

  it("reports an unknown id instead of removing nothing quietly", () => {
    const model = bmiModel();
    try {
      removeNode(model, "nope");
      expect.unreachable("an unknown id is a refusal");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("NODE_NOT_FOUND");
    }
  });
});

describe("moving a node", () => {
  it("changes the parent and the order", () => {
    const model = nestedModel();
    moveNode(model, "leaf-top", "group-b", 0);

    expect(nodeById(model, "leaf-top")?.parent?.id).toBe("group-b");
    expect(nodeById(model, "group-b")?.children.map((child) => child.id)).toEqual([
      "leaf-top",
      "leaf-in-b",
    ]);
    expect(nodeById(model, "group-a")?.children.map((child) => child.id)).toEqual([
      "group-b",
      "leaf-in-a",
    ]);

    const saved = serialiseDocuments(model);
    const form = JSON.parse(saved.formSchemaJson) as {
      fields: { id: string; items?: { id: string; items?: { id: string }[] }[] }[];
    };
    // `group-b` is nested inside `group-a`, so it is addressed through its
    // parent rather than found at the top level.
    const groupAJson = form.fields[0];
    const groupBJson = groupAJson?.items?.find((entry) => entry.id === "group-b");
    expect(groupBJson?.items?.map((entry) => entry.id)).toEqual(["leaf-top", "leaf-in-b"]);
  });

  it("reorders within one parent", () => {
    const model = nestedModel();
    moveNode(model, "leaf-in-a", "group-a", 0);
    expect(nodeById(model, "group-a")?.children.map((child) => child.id)).toEqual([
      "leaf-in-a",
      "group-b",
    ]);
  });

  it("refuses a container inside its own subtree", () => {
    const model = nestedModel();
    for (const target of ["group-b", "leaf-in-b"]) {
      try {
        moveNode(model, "group-a", target, 0);
        expect.unreachable("a node may not move into its own subtree");
      } catch (error) {
        expect((error as EditorModelError).code).toBe("ILLEGAL_MOVE");
      }
    }
    try {
      moveNode(model, "group-a", "group-a", 0);
      expect.unreachable("a node may not become its own parent");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("ILLEGAL_MOVE");
    }
    expect(nodeById(model, "group-a")?.parent).toBeNull();
  });

  it("refuses a container under a repeater on a move too", () => {
    const model = nestedModel();
    try {
      moveNode(model, "group-a", "repeater-r", 0);
      expect.unreachable("a repeater takes per-row answer fields only");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("ILLEGAL_PLACEMENT");
    }
  });

  it("refuses an index outside the sibling list", () => {
    const model = nestedModel();
    try {
      moveNode(model, "leaf-top", "group-b", 9);
      expect.unreachable("index 9 is outside a list of 1");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("ILLEGAL_INDEX");
    }
  });
});

describe("the inspector property table", () => {
  // Transcribed from odd/tasks/form-editor-contract.md. The common four come
  // first, then each row's own extras, in the document's order.
  const table: Record<EditorFieldType, readonly EditableProperty[]> = {
    text: ["title", "description", "required", "readOnly", "minLength", "maxLength", "pattern"],
    textarea: ["title", "description", "required", "readOnly", "minLength", "maxLength"],
    number: [
      "title",
      "description",
      "required",
      "readOnly",
      "minimum",
      "maximum",
      "multipleOf",
      "decimalPlaces",
    ],
    integer: ["title", "description", "required", "readOnly", "minimum", "maximum", "multipleOf"],
    boolean: ["title", "description", "required", "readOnly"],
    date: ["title", "description", "required", "readOnly"],
    datetime: ["title", "description", "required", "readOnly"],
    time: ["title", "description", "required", "readOnly"],
    choice: ["title", "description", "required", "readOnly", "allowMultiple", "options"],
    group: ["title", "description", "required", "readOnly"],
    repeater: ["title", "description", "required", "readOnly", "minItems", "maxItems"],
    "component-ref": ["title", "description", "required", "readOnly"],
  };

  it("matches the contract for all twelve types", () => {
    expect(Object.keys(EDITABLE_PROPERTIES).sort()).toEqual(Object.keys(table).sort());
    for (const type of EDITOR_FIELD_TYPES) {
      expect(editablePropertiesFor(type)).toEqual(table[type]);
      expect(editablePropertiesFor(type)).toHaveLength(new Set(table[type]).size);
    }
  });

  it("answers the legality predicate per type", () => {
    expect(isEditableProperty("text", "pattern")).toBe(true);
    expect(isEditableProperty("text", "decimalPlaces")).toBe(false);
    expect(isEditableProperty("boolean", "minLength")).toBe(false);
    expect(isEditableProperty("choice", "options")).toBe(true);
    expect(isEditableProperty("repeater", "minItems")).toBe(true);
    expect(isEditableProperty("repeater", "minLength")).toBe(false);
  });
});

describe("reading and writing properties", () => {
  it("writes through to the form document", () => {
    const model = bmiModel();
    const node = nodeById(model, "bmi");
    expect(node).not.toBeNull();
    if (node === null) {
      throw new Error("unreachable");
    }
    setNodeProperty(node, "decimalPlaces", 2);
    setNodeProperty(node, "title", "Body mass index");
    setNodeProperty(node, "required", true);

    expect(getNodeProperty(node, "decimalPlaces")).toBe(2);
    expect(getNodeProperty(node, "title")).toBe("Body mass index");
    expect(getNodeProperty(node, "multipleOf")).toBe(0.01);

    const saved = serialiseDocuments(model);
    const form = JSON.parse(saved.formSchemaJson) as { fields: Record<string, unknown>[] };
    expect(form.fields[2]).toEqual({
      id: "bmi",
      code: "body.bmi",
      type: "number",
      readOnly: true,
      multipleOf: 0.01,
      decimalPlaces: 2,
      title: "Body mass index",
      required: true,
    });
  });

  it("reads a choice's options and writes them back", () => {
    const model = parseDocuments({
      formSchemaJson: JSON.stringify({
        fields: [{ id: "c", code: "c", type: "choice" }],
      }),
    });
    const node = nodeById(model, "c");
    if (node === null) {
      throw new Error("unreachable");
    }
    expect(getNodeProperty(node, "options")).toEqual([]);
    setNodeProperty(node, "options", [{ value: "a", label: "A" }, { value: "b" }]);
    setNodeProperty(node, "allowMultiple", true);

    const saved = serialiseDocuments(model);
    expect(saved.formSchemaJson).toBe(
      JSON.stringify({
        fields: [
          {
            id: "c",
            code: "c",
            type: "choice",
            options: [{ value: "a", label: "A" }, { value: "b" }],
            allowMultiple: true,
          },
        ],
      }),
    );
  });

  it("refuses a property the type does not have instead of storing it", () => {
    const model = bmiModel();
    const node = nodeById(model, "bmi");
    if (node === null) {
      throw new Error("unreachable");
    }
    try {
      setNodeProperty(node, "pattern", "a-z");
      expect.unreachable("a number has no pattern to edit");
    } catch (error) {
      expect(error).toBeInstanceOf(EditorModelError);
      expect((error as EditorModelError).code).toBe("PROPERTY_NOT_EDITABLE");
      expect((error as EditorModelError).fieldId).toBe("bmi");
    }
    expect(node.raw["pattern"]).toBeUndefined();
    expect(serialiseDocuments(model).formSchemaJson).toBe(bmiSource().formSchemaJson);
  });

  it("refuses a value of the wrong kind", () => {
    const model = bmiModel();
    const node = nodeById(model, "bmi");
    if (node === null) {
      throw new Error("unreachable");
    }
    try {
      setNodeProperty(node, "minimum", "20");
      expect.unreachable("a minimum is a number");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("INVALID_PROPERTY_VALUE");
    }
  });
});

describe("ui and rules keying", () => {
  it("keys the ui schema by field id, the way the core reads it", () => {
    const ui = { schemaVersion: "1.0.0", fields: { bmi: { hidden: true } } };
    const model = parseDocuments({
      formSchemaJson: bmiSource().formSchemaJson,
      uiSchemaJson: JSON.stringify(ui),
    });
    expect(uiEntryFor(model, "bmi")).toEqual({ hidden: true });
    expect(uiEntryFor(model, "weight-kg")).toBeNull();
    expect(() => uiEntryFor(model, "nope")).toThrowError(EditorModelError);
  });

  it("keys the rules schema by field id", () => {
    const model = bmiModel();
    expect(Object.keys(rulesEntryFor(model, "bmi") ?? {})).toEqual(["calculate"]);
    expect(rulesEntryFor(model, "weight-kg")).toBeNull();
    expect(() => rulesEntryFor(model, "nope")).toThrowError(EditorModelError);
  });

  it("keeps both documents absent when the version had none", () => {
    const model = parseDocuments({ formSchemaJson: bmiSource().formSchemaJson });
    expect(model.ui).toBeNull();
    expect(model.rules).toBeNull();
    const saved = serialiseDocuments(model);
    expect(saved.uiSchemaJson).toBeNull();
    expect(saved.rulesSchemaJson).toBeNull();
  });
});

describe("the id index is the whole document, after every mutation", () => {
  /**
   * The invariant, checked the way the editor observes it.
   *
   * `nodeById` is how the inspector finds the node the tree selected, and the
   * tree walks `root` and `children`. Those are two records of the same fact,
   * so this asserts they agree: the index holds exactly the ids the tree
   * reaches, no more and no fewer, and every one of them resolves to the very
   * node object the tree draws. A node that is in the tree and missing from the
   * index is what an inspector calls "Nothing is selected" for a field the
   * author can see.
   */
  function expectIndexIsComplete(model: DocumentModel): void {
    const walk = (nodes: readonly EditorNode[]): EditorNode[] =>
      nodes.flatMap((node) => [node, ...walk(node.children)]);
    const tree = walk(model.root);
    const walked = fieldIds(model);
    expect(walked).toEqual(tree.map((node) => node.id));
    expect([...model.nodesById.keys()].sort()).toEqual([...walked].sort());
    for (const node of tree) {
      // Identity, not just presence: the index and the tree must be the same
      // node object, or an edit through one would not be seen through the other.
      expect(nodeById(model, node.id), `id ${node.id} is in the tree and must resolve`).toBe(node);
    }
  }

  it("resolves every added node after a second add, not only the latest", () => {
    // The reported reproduction, without the browser: two adds, then a lookup
    // of the *first* node. The index used to be maintained in four places, and
    // a second mutation could leave an earlier node in the tree and out of the
    // index, which is a tree that draws a field nothing can look up.
    const model = parseDocuments({ formSchemaJson: "{}" });
    expectIndexIsComplete(model);

    const text = addField(model, "text", null, { label: "Text" });
    expectIndexIsComplete(model);

    const choice = addField(model, "choice", null, { label: "Choice" });
    expectIndexIsComplete(model);

    expect(nodeById(model, text.id)).not.toBeNull();
    expect(nodeById(model, choice.id)).not.toBeNull();
    expect(nodeById(model, text.id)?.type).toBe("text");
    expect(nodeById(model, choice.id)?.type).toBe("choice");
  });

  it("stays complete across a long run of adds, at the root and inside a container", () => {
    const model = parseDocuments({ formSchemaJson: "{}" });
    for (const type of EDITOR_FIELD_TYPES) {
      addField(model, type, null, {
        label: `Root ${type}`,
        ...(type === "component-ref"
          ? { component: { componentCode: "address-card", componentVersion: "1.0.0" } }
          : {}),
      });
      expectIndexIsComplete(model);
    }
    const group = nodeById(model, "root-group");
    if (group === null) {
      throw new Error("unreachable");
    }
    for (const type of MATERIALIZABLE_FIELD_TYPES) {
      addField(model, type, group.id, { label: `Nested ${type}` });
      expectIndexIsComplete(model);
    }
    expect(fieldIds(model)).toHaveLength(
      EDITOR_FIELD_TYPES.length + MATERIALIZABLE_FIELD_TYPES.length,
    );
  });

  it("is complete after a remove, for the whole document and not the touched node", () => {
    const model = nestedModel();
    expectIndexIsComplete(model);
    removeNode(model, "group-a");
    expectIndexIsComplete(model);
    expect(nodeById(model, "group-a")).toBeNull();
    expect(nodeById(model, "leaf-in-b")).toBeNull();
    // The nodes the remove did not touch still resolve.
    expect(nodeById(model, "leaf-top")?.code).toBe("top");
    expect(nodeById(model, "leaf-in-r")?.code).toBe("in-r");
  });

  it("is complete after a move across parents, for the whole document", () => {
    const model = nestedModel();
    expectIndexIsComplete(model);
    moveNode(model, "leaf-top", "group-b", 0);
    expectIndexIsComplete(model);
    // The untouched siblings resolve, and the moved node resolves under its new
    // parent rather than under the old one.
    expect(nodeById(model, "leaf-in-a")?.parent?.id).toBe("group-a");
    expect(nodeById(model, "leaf-in-b")?.parent?.id).toBe("group-b");
    expect(nodeById(model, "leaf-top")?.parent?.id).toBe("group-b");
  });

  it("is complete after a move of a container, descendants included", () => {
    const model = nestedModel();
    const groupA = nodeById(model, "group-a");
    if (groupA === null) {
      throw new Error("unreachable");
    }
    const subtree = [...subtreeIds(groupA)];
    expect(subtree.length).toBeGreaterThan(1);
    // To the root: a repeater takes per-row answer fields, so it is not a legal
    // destination for a container and this move is about the index, not about
    // the placement rules.
    moveNode(model, "group-a", null, 0);
    expectIndexIsComplete(model);
    for (const id of subtree) {
      expect(nodeById(model, id), `moved descendant ${id} must resolve`).not.toBeNull();
    }
    expect(nodeById(model, "group-b")?.parent?.id).toBe("group-a");
    expect(nodeById(model, "leaf-in-b")?.parent?.id).toBe("group-b");
  });

  it("is complete after a reorder inside one parent", () => {
    const model = nestedModel();
    moveNode(model, "leaf-in-a", "group-a", 0);
    expectIndexIsComplete(model);
    moveNode(model, "leaf-in-b", "group-a", 2);
    expectIndexIsComplete(model);
    expect(fieldIds(model)).toEqual([
      "group-a",
      "leaf-in-a",
      "group-b",
      "leaf-in-b",
      "repeater-r",
      "leaf-in-r",
      "leaf-top",
    ]);
  });

  it("is complete across a chain of mutations, and after a refused one", () => {
    const model = nestedModel();
    const added = addField(model, "textarea", "group-a", { label: "Chain" });
    moveNode(model, added.id, "group-b", 0);
    removeNode(model, "leaf-top");
    moveNode(model, "group-b", null, 0);
    expectIndexIsComplete(model);

    // A refused mutation changes nothing, and the index says so.
    const before = [...model.nodesById.keys()];
    expect(() => addField(model, "group", "repeater-r")).toThrowError(EditorModelError);
    expect(() => moveNode(model, "group-b", "group-b", 0)).toThrowError(EditorModelError);
    expect([...model.nodesById.keys()]).toEqual(before);
    expectIndexIsComplete(model);
  });

  it("rebuilds an index that a stale entry could not survive", () => {
    // The cache is rebuilt wholesale after every mutation, so an entry left
    // behind by anything at all is corrected on the next mutation rather than
    // surviving until somebody looks the id up.
    const model = bmiModel();
    model.nodesById.set("not-a-field", { id: "not-a-field" } as never);
    expect(nodeById(model, "not-a-field")).not.toBeNull();
    addField(model, "text", null, { label: "Sweep" });
    expectIndexIsComplete(model);
    expect(nodeById(model, "not-a-field")).toBeNull();
  });

  it("is complete for a parsed document with nested containers", () => {
    const model = nestedModel();
    expectIndexIsComplete(model);
    const groupB = nodeById(model, "group-b");
    if (groupB === null) {
      throw new Error("unreachable");
    }
    expect(subtreeIds(groupB)).toEqual(["group-b", "leaf-in-b"]);
  });
});

describe("rules go through the model, like every other edit", () => {
  /**
   * The four keys, added to the model's own discipline.
   *
   * These are the model-level facts the builder relies on and does not
   * re-derive: a write is an assignment into the live document, a read hands
   * back the live object, absence removes the key instead of writing a `null`,
   * and a write on a field the document does not have is refused with a code
   * rather than quietly creating one.
   */
  it("writes a key, reads it back, and leaves the rest of the document alone", () => {
    const model = bmiModel();
    expect(getFieldRule(model, "bmi", "calculate")).toEqual({
      op: "div",
      args: [
        { ref: "body.weight.kg" },
        { op: "mul", args: [{ ref: "body.height.m" }, { ref: "body.height.m" }] },
      ],
    });

    setFieldRule(model, "bmi", "visibleWhen", { op: "gt", args: [{ lit: 0 }] });

    expect(getFieldRule(model, "bmi", "visibleWhen")).toEqual({ op: "gt", args: [{ lit: 0 }] });
    // Every other key of the same field, and the form document, byte-identical.
    const saved = serialiseDocuments(model);
    const rules = JSON.parse(saved.rulesSchemaJson as string) as {
      fields: Record<string, Record<string, unknown>>;
    };
    // The written key is appended, so the key that was already there keeps its
    // place: a write is an assignment and does not reorder a document.
    expect(Object.keys(rules.fields["bmi"] as object)).toEqual(["calculate", "visibleWhen"]);
    expect(rules.fields["bmi"]?.["calculate"]).toEqual({
      op: "div",
      args: [
        { ref: "body.weight.kg" },
        { op: "mul", args: [{ ref: "body.height.m" }, { ref: "body.height.m" }] },
      ],
    });
    expect(saved.formSchemaJson).toBe(bmiSource().formSchemaJson);
  });

  it("hands back the live object, so an edit is an assignment and not a projection", () => {
    const model = bmiModel();
    const expression = getFieldRule(model, "bmi", "calculate");
    expect(expression).toBe(rulesEntryFor(model, "bmi")?.["calculate"]);
  });

  it("removes a key on absence instead of storing a null", () => {
    const model = bmiModel();
    setFieldRule(model, "bmi", "calculate", null);

    expect(getFieldRule(model, "bmi", "calculate")).toBeNull();
    // The entry itself stays: another key of it, or a key the editor does not
    // model, may be on it, and deleting the entry would take those too.
    expect(rulesEntryFor(model, "bmi")).toEqual({});
    const saved = serialiseDocuments(model);
    expect(saved.rulesSchemaJson).toBe(
      JSON.stringify({
        schemaVersion: "1.0.0",
        formSchemaVersion: "1.0.0",
        fields: { bmi: {} },
      }),
    );
  });

  it("removes a key on a document with no rules without inventing a rules document", () => {
    const model = parseDocuments({ formSchemaJson: bmiSource().formSchemaJson });
    expect(model.rules).toBeNull();
    setFieldRule(model, "bmi", "visibleWhen", null);
    expect(model.rules).toBeNull();
    expect(serialiseDocuments(model).rulesSchemaJson).toBeNull();
  });

  it("refuses a write on a field id the document does not have, with a code", () => {
    const model = bmiModel();
    try {
      setFieldRule(model, "no-such-field", "visibleWhen", { lit: 1 });
      expect.unreachable("a field that is not in the document has no rules to write");
    } catch (error) {
      expect(error).toBeInstanceOf(EditorModelError);
      expect((error as EditorModelError).code).toBe("NODE_NOT_FOUND");
    }
    // Refused, not ignored: the rules document gained nothing.
    expect(serialiseDocuments(model).rulesSchemaJson).toBe(JSON.stringify(bmi.rules));
  });

  it("refuses a ref to a code no field has, and points at the node", () => {
    const model = bmiModel();
    try {
      setFieldRule(model, "bmi", "visibleWhen", {
        op: "and",
        args: [{ ref: "body.weight.kg" }, { ref: "body.nothing" }],
      });
      expect.unreachable("a ref to nothing is refused");
    } catch (error) {
      const typed = error as EditorModelError;
      expect(typed.code).toBe("INVALID_REFERENCE");
      expect(typed.fieldId).toBe("bmi");
      expect(typed.message).toContain("body.nothing");
      expect(typed.message).toContain("argument 1");
    }
    expect(knownCodeSet(model)).toEqual(new Set(["body.weight.kg", "body.height.m", "body.bmi"]));
    expect(getFieldRule(model, "bmi", "visibleWhen")).toBeNull();
  });

  it("reads a stored ref to a code that is gone, without rewriting it", () => {
    // A ref the author wrote and a field that has since been removed. The model
    // has no basis for guessing which field was meant, so it shows the ref and
    // says it is unresolved rather than silently pointing it somewhere else.
    const rules = {
      schemaVersion: "1.0.0",
      fields: {
        bmi: { visibleWhen: { op: "coalesce", args: [{ ref: "body.removed" }, { lit: 0 }] } },
      },
    };
    const model = parseDocuments({
      formSchemaJson: bmiSource().formSchemaJson,
      rulesSchemaJson: JSON.stringify(rules),
    });
    expect(getFieldRule(model, "bmi", "visibleWhen")).toEqual({
      op: "coalesce",
      args: [{ ref: "body.removed" }, { lit: 0 }],
    });
    expect(knownCodeSet(model).has("body.removed")).toBe(false);
    expect(serialiseDocuments(model).rulesSchemaJson).toBe(JSON.stringify(rules));
  });

  it("keeps a rule whose field was removed and reports it as orphaned", () => {
    const model = bmiModel();
    setFieldRule(model, "height-m", "visibleWhen", { op: "gt", args: [{ lit: 0 }] });
    const withRule = serialiseDocuments(model).rulesSchemaJson;

    // `removeNode` leaves the rules document alone on purpose: a rule the author
    // wrote is not the model's to throw away.
    removeNode(model, "height-m");
    expect(serialiseDocuments(model).rulesSchemaJson).toBe(withRule);
    expect(orphanedRuleFields(model)).toEqual(["height-m"]);
    // And with no field left, the orphan is the only place the rule is visible.
    expect(nodeById(model, "height-m")).toBeNull();
    expect(() => getFieldRule(model, "height-m", "visibleWhen")).toThrowError(EditorModelError);
  });

  it("reports no orphan, and no problem, on a document whose rules are all live", () => {
    const model = bmiModel();
    expect(orphanedRuleFields(model)).toEqual([]);
    expect(fieldRuleProblems(model)).toEqual([]);
    expect(fieldRulesFor(model, "bmi").map((row) => row.key)).toEqual([
      "visibleWhen",
      "enabledWhen",
      "requiredWhen",
      "calculate",
    ]);
  });

  it("reports a stored rule value that is not an expression, without refusing the load", () => {
    // Refusing to open a version would be worse than showing it, so the value is
    // reported and the document is left exactly as it was stored.
    const rules = { fields: { bmi: { calculate: "a div, if you like" } } };
    const model = parseDocuments({
      formSchemaJson: bmiSource().formSchemaJson,
      rulesSchemaJson: JSON.stringify(rules),
    });
    expect(getFieldRule(model, "bmi", "calculate")).toBeNull();
    expect(fieldRuleProblems(model)).toEqual([
      {
        fieldId: "bmi",
        key: "calculate",
        message: "An expression must be an object, not string.",
      },
    ]);
    expect(serialiseDocuments(model).rulesSchemaJson).toBe(JSON.stringify(rules));
  });
});

describe("invalid documents", () => {
  it("raises a typed error for text that is not JSON", () => {
    try {
      parseDocuments({ formSchemaJson: "{ this is not json" });
      expect.unreachable("invalid text must not be accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(EditorModelError);
      expect(error).toBeInstanceOf(Error);
      expect(typeof error).not.toBe("string");
      const typed = error as EditorModelError;
      expect(typed.code).toBe("INVALID_DOCUMENT");
      expect(typed.name).toBe("EditorModelError");
      expect(typed.message).toContain("formSchemaJson");
    }
  });

  it("raises a typed error for JSON that is not an object", () => {
    try {
      parseDocuments({ formSchemaJson: "[1, 2, 3]" });
      expect.unreachable("a document is an object");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("INVALID_DOCUMENT");
    }
  });

  it("raises a typed error for a field with a type outside the twelve", () => {
    try {
      parseDocuments({
        formSchemaJson: JSON.stringify({ fields: [{ id: "m", code: "m", type: "money" }] }),
      });
      expect.unreachable("a thirteenth type must not be accepted");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("INVALID_DOCUMENT");
      expect((error as EditorModelError).message).toContain("twelve editor types");
    }
  });

  it("raises a typed error for a duplicate field id", () => {
    try {
      parseDocuments({
        formSchemaJson: JSON.stringify({
          fields: [
            { id: "x", code: "a", type: "text" },
            { id: "x", code: "b", type: "text" },
          ],
        }),
      });
      expect.unreachable("ids must be unique");
    } catch (error) {
      expect((error as EditorModelError).code).toBe("INVALID_DOCUMENT");
    }
  });
});
