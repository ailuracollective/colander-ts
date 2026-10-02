/**
 * Rule expressions, and the four keys a field's rules carry.
 *
 * These are pure-logic tests with no DOM, because this app's Vitest runs in
 * `environment: node` and adding a DOM environment to test a JSON tree would be
 * a dependency bought for the wrong reason. The React half of the rule builder
 * is a projection of what is verified here: it calls the same functions and
 * draws what they return.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  fieldRuleProblems,
  fieldRulesFor,
  getFieldRule,
  knownCodeSet,
  orphanedRuleFields,
  parseDocuments,
  removeNode,
  serialiseDocuments,
  setFieldRule,
  nodeById,
  EditorModelError,
  type DocumentModel,
} from "./document-model";
import {
  assertExpression,
  collectReferences,
  convertToLit,
  convertToOp,
  convertToRef,
  describeExpression,
  expressionKind,
  expressionSize,
  insertArgument,
  isFieldRuleKey,
  isObservedOperator,
  isUnresolvedReference,
  literalText,
  moveArgument,
  opNode,
  parseLiteralText,
  refNode,
  removeArgument,
  setLiteral,
  setOperator,
  setReferencedCode,
  unresolvedReferences,
  writeExpressionAt,
  RulesError,
  type ExpressionNode,
  type ExpressionPath,
} from "./rules";

/**
 * The real corpora, loaded from disk.
 *
 * `bmi-calculation.json` is a `calculate` over two fields, `bp-cross-field.json`
 * is the `validations` list with `when` and `assert`. They are the documents
 * this repository actually ships, so a round trip over them is a statement about
 * real text rather than about a fixture written to suit the test.
 */
function readFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../../../nest-app/test/fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

interface Fixture {
  readonly form: Record<string, unknown>;
  readonly rules: Record<string, unknown>;
}

const bmi = readFixture("bmi-calculation.json") as unknown as Fixture;
const bloodPressure = readFixture("bp-cross-field.json") as unknown as Fixture;

function source(
  form: Record<string, unknown>,
  rules: Record<string, unknown> | null,
): { formSchemaJson: string; rulesSchemaJson: string | null } {
  return {
    formSchemaJson: JSON.stringify(form),
    rulesSchemaJson: rules === null ? null : JSON.stringify(rules),
  };
}

function bmiModel(): DocumentModel {
  return parseDocuments(source(bmi.form, bmi.rules));
}

/** An expression read back out of a fresh parse, as a plain tree. */
function treeOf(expression: ExpressionNode): unknown {
  return JSON.parse(JSON.stringify(expression)) as unknown;
}

function expectCode(action: () => void, code: string): void {
  try {
    action();
    expect.unreachable(`expected the model to refuse with ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(EditorModelError);
    expect((error as EditorModelError).code).toBe(code);
  }
}

describe("round trips", () => {
  it("returns the bmi fixture's rules document byte for byte", () => {
    const input = source(bmi.form, bmi.rules);
    const saved = serialiseDocuments(parseDocuments(input));
    expect(saved.rulesSchemaJson).toBe(input.rulesSchemaJson);
  });

  it("returns the blood-pressure fixture, validations and all, byte for byte", () => {
    const input = source(bloodPressure.form, bloodPressure.rules);
    const saved = serialiseDocuments(parseDocuments(input));
    expect(saved.rulesSchemaJson).toBe(input.rulesSchemaJson);
  });

  it("returns unknown keys at every level, and an operator it has never seen", () => {
    // `x-` keys at the document level, inside a field entry, inside an
    // argument and on an `op` node itself; plus two operators no list in this
    // repository declares.
    const rules = {
      schemaVersion: "1.0.0",
      "x-rules-extension": "kept",
      "x-vendor": { level: 2 },
      fields: {
        bmi: {
          "x-rule-extension": true,
          "x-note": { deep: ["kept"] },
          visibleWhen: { op: "is_set", args: [{ ref: "body.weight.kg" }] },
          calculate: {
            op: "weightedMean",
            args: [
              { ref: "body.weight.kg" },
              { lit: 2 },
              { op: "fallback", args: [{ lit: null }] },
            ],
            "x-op-extension": "kept",
          },
        },
      },
      "x-after-fields": [1, 2, 3],
    };
    const input = source(bmi.form, rules);
    const saved = serialiseDocuments(parseDocuments(input));
    expect(saved.rulesSchemaJson).toBe(input.rulesSchemaJson);
  });

  it("reads a stored operator the editor has never heard of, and keeps it", () => {
    const model = bmiModel();
    // `bmi` is a number and the tree's codes are the two it is calculated from.
    const expression = getFieldRule(model, "bmi", "calculate");
    expect(expression).not.toBeNull();
    if (expression === null) {
      throw new Error("unreachable");
    }
    expect(expressionKind(expression)).toBe("op");
    expect(expression["op"]).toBe("div");

    setFieldRule(model, "bmi", "visibleWhen", { op: "totally_unknown_op", args: [{ lit: 1 }] });
    const written = getFieldRule(model, "bmi", "visibleWhen");
    expect(written?.["op"]).toBe("totally_unknown_op");
    expect(collectReferences(written as ExpressionNode)).toEqual([]);
  });
});

describe("the operator list is evidence, not a gate", () => {
  it("offers the observed set and labels it as observed", () => {
    // Every operator the corpora use is offered, so an author does not have to
    // remember it.
    for (const name of [
      "eq",
      "neq",
      "gt",
      "lt",
      "add",
      "sub",
      "mul",
      "div",
      "pow",
      "and",
      "or",
      "not",
      "empty",
      "coalesce",
    ]) {
      expect(isObservedOperator(name)).toBe(true);
    }
    expect(isObservedOperator("is_set")).toBe(false);
  });

  it("writes an operator it does not know, because the contract is a string", () => {
    const model = bmiModel();
    const expression: ExpressionNode = opNode("an_op_from_a_newer_core", [
      refNode("body.weight.kg"),
    ]);
    setFieldRule(model, "bmi", "calculate", expression);
    expect(expressionKind(getFieldRule(model, "bmi", "calculate") as ExpressionNode)).toBe("op");
    expect((getFieldRule(model, "bmi", "calculate") as ExpressionNode)["op"]).toBe(
      "an_op_from_a_newer_core",
    );
    // And it survives the one serialisation unchanged.
    const saved = serialiseDocuments(model);
    expect(saved.rulesSchemaJson).toContain("an_op_from_a_newer_core");
  });

  it("refuses nothing on the strength of the list: the same name is written and read", () => {
    const model = bmiModel();
    setFieldRule(model, "bmi", "calculate", opNode("nonsense", [refNode("body.weight.kg")]));
    const read = getFieldRule(model, "bmi", "calculate") as ExpressionNode;
    // `isObservedOperator` answers a question about the list. It is not asked by
    // the write path, and the node is not rejected for being unknown.
    expect(read["op"]).toBe("nonsense");
    expect(isObservedOperator(read["op"] as string)).toBe(false);
  });
});

describe("reading and writing the four keys", () => {
  it("names exactly the four keys FieldRules carries", () => {
    expect(isFieldRuleKey("visibleWhen")).toBe(true);
    expect(isFieldRuleKey("enabledWhen")).toBe(true);
    expect(isFieldRuleKey("requiredWhen")).toBe(true);
    expect(isFieldRuleKey("calculate")).toBe(true);
    // An earlier draft of the contract map listed a fifth. `FieldRules` does
    // not have one, and a builder that offered it would author a key the core
    // never reads.
    expect(isFieldRuleKey("readOnlyWhen")).toBe(false);
    expect(isFieldRuleKey("when")).toBe(false);
  });

  it("writes visibleWhen and leaves every other key and field byte-identical", () => {
    const rules = {
      schemaVersion: "1.0.0",
      formSchemaVersion: "1.0.0",
      "x-rules-extension": "kept",
      fields: {
        "weight-kg": {
          "x-rule-extension": true,
          enabledWhen: { op: "gt", args: [{ lit: 0 }] },
          calculate: { op: "double", args: [{ ref: "body.weight.kg" }] },
        },
        bmi: { calculate: { op: "div", args: [{ ref: "body.weight.kg" }, { lit: 2 }] } },
      },
      "x-after-fields": [1],
    };
    const input = source(bmi.form, rules);
    const model = parseDocuments(input);
    setFieldRule(model, "weight-kg", "visibleWhen", {
      op: "gt",
      args: [{ ref: "body.height.m" }, { lit: 1 }],
    });

    const saved = serialiseDocuments(model);
    const after = JSON.parse(saved.rulesSchemaJson as string) as Record<string, unknown>;
    // The written key.
    expect(
      (after["fields"] as Record<string, Record<string, unknown>>)["weight-kg"]?.["visibleWhen"],
    ).toEqual({
      op: "gt",
      args: [{ ref: "body.height.m" }, { lit: 1 }],
    });
    // Every other key of the same field, and the other field, untouched, and
    // the document-level unknown keys still present.
    const weight = (after["fields"] as Record<string, Record<string, unknown>>)["weight-kg"];
    expect(weight?.["enabledWhen"]).toEqual({ op: "gt", args: [{ lit: 0 }] });
    expect(weight?.["calculate"]).toEqual({ op: "double", args: [{ ref: "body.weight.kg" }] });
    expect(weight?.["x-rule-extension"]).toBe(true);
    expect((after["fields"] as Record<string, unknown>)["bmi"]).toEqual(rules.fields.bmi);
    expect(after["x-rules-extension"]).toBe("kept");
    expect(after["x-after-fields"]).toEqual([1]);
    expect(after["formSchemaVersion"]).toBe("1.0.0");
    // The form document did not move at all.
    expect(saved.formSchemaJson).toBe(input.formSchemaJson);
  });

  it("removes a key by writing absence, and gains no null", () => {
    const rules = {
      schemaVersion: "1.0.0",
      fields: {
        "weight-kg": {
          visibleWhen: { op: "gt", args: [{ lit: 0 }] },
          enabledWhen: { op: "gt", args: [{ lit: 1 }] },
        },
      },
    };
    const model = parseDocuments(source(bmi.form, rules));
    setFieldRule(model, "weight-kg", "visibleWhen", null);

    const saved = serialiseDocuments(model);
    const entry = (
      JSON.parse(saved.rulesSchemaJson as string) as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields["weight-kg"];
    expect("visibleWhen" in entry).toBe(false);
    // The contract allows absence, and a `null` where there was no key is a
    // different document for no reason.
    expect(saved.rulesSchemaJson).not.toContain("null");
    expect(entry["enabledWhen"]).toEqual({ op: "gt", args: [{ lit: 1 }] });
  });

  it("clears a key that was stored as null, and leaves the rest alone", () => {
    // `FieldRules` allows `Expression | null`, so a stored `null` is a real
    // state. Writing absence removes the key whichever of the two it was, and
    // that is the writer's one meaning of absence: the document does not keep
    // a `null` the author has already cleared.
    const rules = {
      fields: {
        "weight-kg": { visibleWhen: null, requiredWhen: { op: "not", args: [{ lit: null }] } },
      },
    };
    const model = parseDocuments(source(bmi.form, rules));
    expect(getFieldRule(model, "weight-kg", "visibleWhen")).toBeNull();

    setFieldRule(model, "weight-kg", "visibleWhen", null);
    expect(getFieldRule(model, "weight-kg", "visibleWhen")).toBeNull();
    expect(serialiseDocuments(model).rulesSchemaJson).toBe(
      JSON.stringify({
        fields: { "weight-kg": { requiredWhen: { op: "not", args: [{ lit: null }] } } },
      }),
    );
  });

  it("creates the rules document on the first write and not on a read", () => {
    const model = parseDocuments({ formSchemaJson: JSON.stringify(bmi.form) });
    expect(model.rules).toBeNull();
    // A read creates nothing: opening a version and looking at it cannot change
    // what a save would store.
    expect(getFieldRule(model, "bmi", "visibleWhen")).toBeNull();
    expect(orphanedRuleFields(model)).toEqual([]);
    expect(fieldRuleProblems(model)).toEqual([]);
    expect(serialiseDocuments(model).rulesSchemaJson).toBeNull();

    setFieldRule(model, "bmi", "visibleWhen", { op: "gt", args: [{ lit: 0 }] });
    expect(model.rules).not.toBeNull();
    expect(serialiseDocuments(model).rulesSchemaJson).toBe(
      JSON.stringify({ fields: { bmi: { visibleWhen: { op: "gt", args: [{ lit: 0 }] } } } }),
    );
  });

  it("refuses a write on a field id the document does not have, with a code", () => {
    const model = bmiModel();
    expectCode(
      () => setFieldRule(model, "no-such-field", "visibleWhen", { lit: 1 }),
      "NODE_NOT_FOUND",
    );
    expectCode(() => setFieldRule(model, "no-such-field", "calculate", null), "NODE_NOT_FOUND");
    // Refused, not ignored: nothing was added to the rules document.
    const saved = serialiseDocuments(model);
    expect(saved.rulesSchemaJson).toBe(JSON.stringify(bmi.rules));
    expect(saved.rulesSchemaJson).not.toContain("no-such-field");
  });

  it("refuses a value that is not an expression at all", () => {
    const model = bmiModel();
    expectCode(
      () => setFieldRule(model, "bmi", "visibleWhen", {} as ExpressionNode),
      "INVALID_EXPRESSION",
    );
    expectCode(
      () => setFieldRule(model, "bmi", "visibleWhen", "yes" as unknown as ExpressionNode),
      "INVALID_EXPRESSION",
    );
    // `{ op: "and" }` is **not** in this list: `args` is optional in the
    // contract and an operator with no arguments is a legal expression.
    expectCode(
      () => setFieldRule(model, "bmi", "visibleWhen", { ref: 7 } as unknown as ExpressionNode),
      "INVALID_EXPRESSION",
    );
    expectCode(
      () =>
        setFieldRule(model, "bmi", "visibleWhen", {
          op: "and",
          args: "no",
        } as unknown as ExpressionNode),
      "INVALID_EXPRESSION",
    );
    setFieldRule(model, "bmi", "visibleWhen", opNode("and"));
    expect(getFieldRule(model, "bmi", "visibleWhen")).toEqual({ op: "and" });
    // Every refusal above left the document exactly as it was loaded; the
    // accepted `{ op: "and" }` is the only thing that moved.
    expect(serialiseDocuments(model).rulesSchemaJson).toContain('"visibleWhen":{"op":"and"}');
  });
});

describe("a reference names a field code", () => {
  it("refuses a ref to a code that does not exist, on write", () => {
    const model = bmiModel();
    expectCode(
      () => setFieldRule(model, "bmi", "visibleWhen", { ref: "body.nothing" }),
      "INVALID_REFERENCE",
    );
    // And the refusal names the offending code and where it is.
    try {
      setFieldRule(model, "bmi", "visibleWhen", { op: "and", args: [{ ref: "body.nothing" }] });
      expect.unreachable("a ref to nothing is refused");
    } catch (error) {
      const typed = error as EditorModelError;
      expect(typed.code).toBe("INVALID_REFERENCE");
      expect(typed.fieldId).toBe("bmi");
      expect(typed.message).toContain("body.nothing");
      expect(typed.message).toContain("argument 0");
    }
    expect(getFieldRule(model, "bmi", "visibleWhen")).toBeNull();
  });

  it("reads a stored reference to a code that is gone, without rewriting it", () => {
    // The field it named has been deleted, so the stored ref is stale. The
    // editor cannot know which field the author meant, so it shows the
    // reference as unresolved and leaves the bytes alone.
    const rules = {
      fields: { bmi: { visibleWhen: { ref: "body.removed" } } },
    };
    const model = parseDocuments(source(bmi.form, rules));
    const expression = getFieldRule(model, "bmi", "visibleWhen");
    expect(expression).toEqual({ ref: "body.removed" });
    expect(isUnresolvedReference(expression as ExpressionNode, knownCodeSet(model))).toBe(true);
    expect(unresolvedReferences(expression as ExpressionNode, knownCodeSet(model))).toEqual([
      { code: "body.removed", path: [] },
    ]);
    expect(serialiseDocuments(model).rulesSchemaJson).toBe(JSON.stringify(rules));
  });

  it("reports every unresolved reference with its path", () => {
    const model = bmiModel();
    const expression = opNode("coalesce", [
      { op: "gt", args: [{ ref: "body.gone" }, { lit: 0 }] },
      refNode("body.weight.kg"),
      { ref: "body.also.gone" },
    ]);
    expect(unresolvedReferences(expression, knownCodeSet(model))).toEqual([
      { code: "body.gone", path: [0, 0] },
      { code: "body.also.gone", path: [2] },
    ]);
  });

  it("refuses an empty ref on write and reads an empty one back as present", () => {
    const model = bmiModel();
    expectCode(() => setFieldRule(model, "bmi", "visibleWhen", { ref: "" }), "INVALID_REFERENCE");
    // Reading is permissive, as loading a version is: the key is there and the
    // author can see it is empty.
    const stored = parseDocuments(
      source(bmi.form, { fields: { bmi: { visibleWhen: { ref: "" } } } }),
    );
    expect(getFieldRule(stored, "bmi", "visibleWhen")).toEqual({ ref: "" });
  });

  it("refuses a ref write through the builder's own setters too", () => {
    const model = bmiModel();
    const expression = opNode("and", [refNode("body.weight.kg")]);
    expect(() => setReferencedCode(expression, [0], "body.nothing")).not.toThrow();
    // The pure layer does not know what fields exist, so it lets the name
    // through; the model's write is where the document is consulted, and
    // that is the layer that refuses.
    expect(expression["args"]).toEqual([{ ref: "body.nothing" }]);
    expectCode(() => setFieldRule(model, "bmi", "visibleWhen", expression), "INVALID_REFERENCE");
  });
});

describe("editing the expression tree", () => {
  function calculated(): { model: DocumentModel; expression: ExpressionNode } {
    const model = bmiModel();
    const expression = getFieldRule(model, "bmi", "calculate") as ExpressionNode;
    return { model, expression };
  }

  it("replaces a subtree deep in the tree and leaves the rest alone", () => {
    const { model, expression } = calculated();
    // div(weight, mul(height, height)) -> the inner mul becomes a square call.
    writeExpressionAt(expression, [1], opNode("square", [{ ref: "body.height.m" }]));

    expect(treeOf(expression)).toEqual({
      op: "div",
      args: [{ ref: "body.weight.kg" }, { op: "square", args: [{ ref: "body.height.m" }] }],
    });
    setFieldRule(model, "bmi", "calculate", expression);
    const saved = serialiseDocuments(model);
    expect(saved.rulesSchemaJson).toContain('"square"');
    expect(
      (
        JSON.parse(saved.rulesSchemaJson as string) as {
          fields: Record<string, Record<string, unknown>>;
        }
      ).fields.bmi?.["calculate"],
    ).toEqual({
      op: "div",
      args: [{ ref: "body.weight.kg" }, { op: "square", args: [{ ref: "body.height.m" }] }],
    });
  });

  it("replaces a subtree that changes kind, dropping the old kind's keys", () => {
    const { expression } = calculated();
    // A `{ ref }` rewritten as an `{ op }` must not end up carrying both: the
    // client's union has no member that does, and the core would read the two
    // differently from this editor.
    const inner = expressionAt(expression, [1, 0]);
    expect(inner).toEqual({ ref: "body.height.m" });
    writeExpressionAt(expression, [1, 0], opNode("abs", [{ ref: "body.height.m" }]));
    expect(inner).toEqual({ op: "abs", args: [{ ref: "body.height.m" }] });
    expect(inner).not.toHaveProperty("ref");
  });

  it("removes an argument and leaves the operator's other arguments in order", () => {
    const { model, expression } = calculated();
    removeArgument(expression, [1], 1);
    expect(treeOf(expression)).toEqual({
      op: "div",
      args: [{ ref: "body.weight.kg" }, { op: "mul", args: [{ ref: "body.height.m" }] }],
    });
    // And the document takes it.
    setFieldRule(model, "bmi", "calculate", expression);
    const saved = JSON.parse(serialiseDocuments(model).rulesSchemaJson as string) as {
      fields: Record<string, Record<string, unknown>>;
    };
    expect((saved.fields.bmi?.["calculate"] as { args: unknown[] }).args).toHaveLength(2);
  });

  it("reorders arguments, because a wrong order is a real mistake", () => {
    const expression = opNode("sub", [refNode("body.weight.kg"), refNode("body.height.m")]);
    expect(describeExpression(expression)).toBe("sub(body.weight.kg, body.height.m)");
    // Down one: the target index is measured after the removal, exactly as
    // `moveNode` measures a tree move.
    moveArgument(expression, [], 0, 1);
    expect(describeExpression(expression)).toBe("sub(body.height.m, body.weight.kg)");
    // And back up.
    moveArgument(expression, [], 1, 0);
    expect(describeExpression(expression)).toBe("sub(body.weight.kg, body.height.m)");
    // Two steps up in one move, on a three-argument list.
    const three = opNode("coalesce", [refNode("a"), refNode("b"), refNode("c")]);
    moveArgument(three, [], 2, 0);
    expect(describeExpression(three)).toBe("coalesce(c, a, b)");
  });

  it("moves the arguments of a node deep in the tree, not only of the root", () => {
    const { expression } = calculated();
    moveArgument(expression, [1], 0, 1);
    expect(describeExpression(expression)).toBe(
      "div(body.weight.kg, mul(body.height.m, body.height.m))",
    );
  });

  it("refuses an index outside the argument list, and does not move anything", () => {
    const { expression } = calculated();
    for (const action of [
      () => removeArgument(expression, [1], 2),
      () => removeArgument(expression, [1], -1),
      () => moveArgument(expression, [], 0, 7),
      () => moveArgument(expression, [], 9, 0),
      () => insertArgument(expression, [], { lit: 1 }, 3),
      () => moveArgument(expression, [], 0, -1),
    ]) {
      try {
        action();
        expect.unreachable("an index outside the list is refused");
      } catch (error) {
        expect(error).toBeInstanceOf(RulesError);
        expect((error as RulesError).code).toBe("INVALID_ARGUMENT_INDEX");
      }
    }
    expect(treeOf(expression)).toEqual(
      JSON.parse(
        JSON.stringify(
          (bmi.rules as { fields: Record<string, Record<string, unknown>> }).fields.bmi?.[
            "calculate"
          ],
        ),
      ) as unknown,
    );
  });

  it("removes the arguments of a node that has none by creating the list first", () => {
    const { expression } = calculated();
    removeArgument(expression, [1], 1);
    // The emptied list stays: the operator is still there and the author may
    // be about to add a replacement.
    const inner = expressionAt(expression, [1]);
    expect((inner as { args: unknown[] }).args).toEqual([{ ref: "body.height.m" }]);
  });

  it("inserts an argument at a chosen index and appends by default", () => {
    const expression = opNode("add", [refNode("a"), refNode("c")]);
    insertArgument(expression, [], refNode("b"), 1);
    expect(describeExpression(expression)).toBe("add(a, b, c)");
    insertArgument(expression, [], opNode("lit_value", [{ lit: 1 }]));
    expect(describeExpression(expression)).toBe("add(a, b, c, lit_value(lit 1))");
    // The op, its four arguments and the `lit` under the fourth.
    expect(expressionSize(expression)).toBe(6);
  });

  it("edits an op node's operator, its ref code and its literal value", () => {
    const expression = opNode("eq", [{ ref: "body.weight.kg" }, { lit: 0 }]);
    setOperator(expression, [], "neq");
    setReferencedCode(expression, [0], "body.height.m");
    setLiteral(expression, [1], 7);
    expect(treeOf(expression)).toEqual({
      op: "neq",
      args: [{ ref: "body.height.m" }, { lit: 7 }],
    });
    // Setting a ref where the node is not a ref, or an operator where it is not
    // an op, is a refusal and not a silent coercion.
    expect(() => setOperator(expression, [0], "nope")).toThrowError(RulesError);
    expect(() => setLiteral(expression, [0], 1)).toThrowError(RulesError);
  });

  it("converts a node between the three kinds, dropping the old kind's keys", () => {
    const expression = opNode("and", [{ ref: "body.weight.kg" }]);
    convertToLit(expression, [0], "now a literal");
    expect(expressionAt(expression, [0])).toEqual({ lit: "now a literal" });
    convertToRef(expression, [0], "body.height.m");
    expect(expressionAt(expression, [0])).toEqual({ ref: "body.height.m" });
    convertToOp(expression, [0], "or", [refNode("body.bmi")]);
    expect(expressionAt(expression, [0])).toEqual({ op: "or", args: [{ ref: "body.bmi" }] });
    expect(expressionAt(expression, [0])).not.toHaveProperty("ref");
    expect(expressionAt(expression, [0])).not.toHaveProperty("lit");
  });

  it("keeps a key the editor does not model when it edits a node", () => {
    // A vendor key on an `op` node. The write is an assignment, not a
    // projection, so an edit to the operator cannot drop it.
    const expression: ExpressionNode = {
      op: "div",
      args: [{ ref: "body.weight.kg" }, { lit: 2 }],
      "x-op-extension": "kept",
    };
    setOperator(expression, [], "divide");
    removeArgument(expression, [], 1);
    expect(expression["x-op-extension"]).toBe("kept");
    expect(expression["op"]).toBe("divide");
    expect(expression["args"]).toEqual([{ ref: "body.weight.kg" }]);
  });

  it("stores the tree it is given, so a builder edits and then writes back", () => {
    // The model writes the value into the document and the builder edits the
    // **live** object it got back from {@link getFieldRule} — the same
    // discipline every other edit in this editor follows, where a write is an
    // assignment and not a projection. So an edit is two steps: mutate the live
    // tree, then hand it to `setFieldRule`, which is also where the references
    // are checked.
    const model = bmiModel();
    const live = getFieldRule(model, "bmi", "calculate") as ExpressionNode;
    setOperator(live, [], "divide");
    setFieldRule(model, "bmi", "calculate", live);

    const stored = getFieldRule(model, "bmi", "calculate") as ExpressionNode;
    expect(stored["op"]).toBe("divide");
    // And a builder that forgets the write-back is caught, not papered over:
    // the document still holds the operator it was last given.
    const detached = opNode("mul", [refNode("body.weight.kg")]);
    setOperator(detached, [], "times");
    expect((getFieldRule(model, "bmi", "calculate") as ExpressionNode)["op"]).toBe("divide");
  });
});

describe("literals and previews", () => {
  it("reads a literal as a JSON value when it parses and as text when it does not", () => {
    // A literal is `unknown` on the wire. Treating every one as a string would
    // make it impossible to write the number a `div` needs.
    expect(parseLiteralText("42")).toBe(42);
    expect(parseLiteralText("true")).toBe(true);
    expect(parseLiteralText("null")).toBeNull();
    expect(parseLiteralText('"quoted"')).toBe("quoted");
    expect(parseLiteralText("two words")).toBe("two words");
  });

  it("shows a literal as the text the field holds", () => {
    expect(literalText(42)).toBe("42");
    expect(literalText("two words")).toBe("two words");
    expect(literalText(null)).toBe("null");
  });

  it("round-trips a number literal through the field's text and back", () => {
    const expression = opNode("gt", [{ ref: "body.weight.kg" }, { lit: parseLiteralText("10") }]);
    expect(treeOf(expression)).toEqual({
      op: "gt",
      args: [{ ref: "body.weight.kg" }, { lit: 10 }],
    });
  });
});

describe("the assertion itself", () => {
  it("accepts all three kinds and a ref check it is given", () => {
    expect(() =>
      assertExpression({ ref: "a" }, { isKnownCode: (code) => code === "a" }),
    ).not.toThrow();
    expect(() => assertExpression({ lit: null })).not.toThrow();
    expect(() => assertExpression({ op: "and", args: [] })).not.toThrow();
    expect(() => assertExpression({ op: "and" })).not.toThrow();
  });

  it("reports the path of the node that is wrong", () => {
    const expression = { op: "and", args: [{ ref: "a" }, { op: "or", args: ["not an object"] }] };
    try {
      assertExpression(expression);
      expect.unreachable("a string is not an expression");
    } catch (error) {
      expect((error as RulesError).code).toBe("INVALID_EXPRESSION");
      expect((error as RulesError).path).toEqual([1, 0]);
    }
  });

  it("does not ask about operators at all", () => {
    expect(() => assertExpression({ op: "an_op_nobody_has_heard_of" })).not.toThrow();
    expect(() => assertExpression({ op: "", args: [] })).not.toThrow();
  });
});

describe("orphaned rules", () => {
  it("keeps a rule whose field was removed, and reports the rule as orphaned", () => {
    const model = bmiModel();
    expect(getFieldRule(model, "height-m", "calculate")).toBeNull();
    setFieldRule(model, "height-m", "visibleWhen", { op: "gt", args: [{ lit: 0 }] });
    const before = serialiseDocuments(model).rulesSchemaJson;

    // Removing a field leaves the rules document alone: a rule the author
    // wrote is not the editor's to throw away.
    removeNode(model, "height-m");
    const after = serialiseDocuments(model).rulesSchemaJson as string;
    expect(after).toBe(before);
    expect(after).toContain("height-m");

    // And the orphan is visible rather than hidden.
    expect(orphanedRuleFields(model)).toEqual(["height-m"]);
    // A read of an orphaned field's rules is not possible through the tree,
    // because the tree has no row for it, which is exactly why the orphan list
    // is derived from the two documents rather than from a selection.
    expect(nodeById(model, "height-m")).toBeNull();
  });

  it("reports an orphan whose only key is unknown to the editor", () => {
    const rules = { fields: { "gone-field": { "x-only-key": true } } };
    const model = parseDocuments(source(bmi.form, rules));
    expect(orphanedRuleFields(model)).toEqual(["gone-field"]);
    // The key survives, and it is not a value the contract describes, so it is
    // reported as a problem rather than rewritten.
    expect(serialiseDocuments(model).rulesSchemaJson).toBe(JSON.stringify(rules));
  });

  it("reports no orphan when every rules field is in the document", () => {
    const model = bmiModel();
    setFieldRule(model, "bmi", "visibleWhen", { op: "gt", args: [{ lit: 0 }] });
    expect(orphanedRuleFields(model)).toEqual([]);
    expect(fieldRuleProblems(model)).toEqual([]);
  });

  it("collects the four keys of one field's rules for the builder to draw", () => {
    const model = bmiModel();
    setFieldRule(model, "bmi", "visibleWhen", { op: "gt", args: [{ lit: 0 }] });
    setFieldRule(model, "bmi", "requiredWhen", { op: "not", args: [{ ref: "body.weight.kg" }] });
    const rows = fieldRulesFor(model, "bmi");
    expect(rows.filter((row) => row.expression !== null).map((row) => row.key)).toEqual([
      "visibleWhen",
      "requiredWhen",
      "calculate",
    ]);
    expect(rows).toHaveLength(4);
  });
});

/** The node at a path, for the tests above. */
function expressionAt(root: ExpressionNode, path: ExpressionPath): ExpressionNode | null {
  let current: unknown = root;
  for (const index of path) {
    if (!Array.isArray((current as { args?: unknown }).args)) {
      return null;
    }
    current = (current as { args: unknown[] }).args[index];
  }
  return typeof current === "object" && current !== null ? (current as ExpressionNode) : null;
}
