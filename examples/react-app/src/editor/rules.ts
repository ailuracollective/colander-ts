/**
 * Rule expressions: what the core calls an `Expression`, as a tree the editor
 * can edit.
 *
 * The vocabulary this module speaks is the client's, unchanged:
 * `{ ref }`, `{ lit }` and `{ op, args? }`. Every function here works on a
 * **live** expression object out of the parsed rules document and writes into
 * it; nothing projects an expression into a new object, for the same reason
 * `document-model.ts` never projects a field: a key this file does not model
 * has to survive an edit.
 *
 * ## The operator list is observed, not declared
 *
 * `op` is a plain `string` in the client's `Expression`, so nothing in
 * TypeScript enumerates the operators the core accepts, and the Rust core is
 * not in this tree — only its built artifact. {@link OBSERVED_OPERATORS} is
 * therefore the set of operators that appear in this repository's corpora (the
 * nest-app fixtures and the sample documents), and it is *evidence*, not a
 * declaration. Two consequences are designed in rather than wished for:
 *
 * - the list is offered as suggestions and never used to refuse a name, so an
 *   operator this module has never heard of stays expressible. The contract is
 *   a string; refusing to name one would make the editor unable to describe a
 *   document the core accepts;
 * - the core disposes. An operator the core does not know is refused at
 *   compile, and the editor already surfaces that through the `schemaCheck` the
 *   API returns on a version read. Guessing here would be a second, worse
 *   source of truth.
 *
 * There is deliberately no `switch` over operators in this file: one would be a
 * claim of completeness, and a claim of completeness is the thing this comment
 * exists to prevent.
 */

/**
 * Operators seen in this repository's corpora. Suggestions only.
 *
 * See the module comment: this is what the fixtures happen to use, kept so an
 * author does not have to remember it, and never used to reject a name.
 */
export const OBSERVED_OPERATORS = [
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
] as const;

export type ObservedOperator = (typeof OBSERVED_OPERATORS)[number];

/** Whether a name is one of the observed operators. Never a validity check. */
export function isObservedOperator(name: string): boolean {
  return (OBSERVED_OPERATORS as readonly string[]).includes(name);
}

/**
 * The four keys one field's rules carry, and what each one *means*.
 *
 * `visibleWhen`, `enabledWhen` and `requiredWhen` are conditions: the core
 * evaluates them to a boolean and hides, disables or demands the field
 * accordingly. `calculate` is not a condition — it produces a value, so its
 * result is not a boolean and an author reading it as "when" is reading it
 * wrong. The distinction is data here so the builder can say it, instead of four
 * identical text boxes labelled with the same word four times.
 *
 * The key order is the client's `FieldRules` order and is the order the
 * builder draws.
 */
export const FIELD_RULE_ROWS = [
  {
    key: "visibleWhen",
    kind: "condition",
    label: "visibleWhen",
    meaning: "show this field only when the condition holds",
  },
  {
    key: "enabledWhen",
    kind: "condition",
    label: "enabledWhen",
    meaning: "let this field be answered only when the condition holds",
  },
  {
    key: "requiredWhen",
    kind: "condition",
    label: "requiredWhen",
    meaning: "demand an answer only when the condition holds",
  },
  {
    key: "calculate",
    kind: "value",
    label: "calculate",
    meaning:
      "produce this field's value from the expression; the result is a value, not a yes or no",
  },
] as const;

/** One of the four rule keys a field carries. */
export type FieldRuleKey = (typeof FIELD_RULE_ROWS)[number]["key"];

/** Every rule key, in the client's order. */
export const FIELD_RULE_KEYS: readonly FieldRuleKey[] = FIELD_RULE_ROWS.map((row) => row.key);

/** The keys whose result is a boolean condition. */
export const CONDITION_RULE_KEYS: readonly FieldRuleKey[] = FIELD_RULE_ROWS.filter(
  (row) => row.kind === "condition",
).map((row) => row.key);

/** One rule row: the key, and what the key means. */
export type FieldRuleRow = (typeof FIELD_RULE_ROWS)[number];

/** Whether a string is one of the four rule keys. */
export function isFieldRuleKey(key: string): key is FieldRuleKey {
  return (FIELD_RULE_KEYS as readonly string[]).includes(key);
}

/** What an expression node is. `null` when it is not a node at all. */
export type ExpressionKind = "ref" | "lit" | "op";

/**
 * A live expression object, as it sits in the parsed rules document.
 *
 * The client's `Expression` is `readonly` and closed to three keys; the
 * document may carry more, so the editor's working type is the open record and
 * the client shape is the *expected* shape, checked by
 * {@link assertExpression} rather than assumed by the type.
 */
export type ExpressionNode = Record<string, unknown>;

/** An `op` node, which is the only kind with arguments. */
export interface OpNode extends ExpressionNode {
  op: string;
  args: unknown[];
}

/**
 * Where a node sits, as the list of argument indexes walked from the root.
 *
 * An empty path is the root. The path is a list rather than a chain of ids
 * because arguments are an **ordered list** and order is part of the meaning:
 * `sub(a, b)` is not `sub(b, a)`, and reordering arguments is an edit the
 * builder has to be able to make.
 */
export type ExpressionPath = readonly number[];

/** The path of an argument of the node at `path`. */
function childPath(path: ExpressionPath, index: number): ExpressionPath {
  return [...path, index];
}

/** Every reason this module refuses, as a code. Mirrors the model's own codes. */
export type RulesErrorCode = "INVALID_EXPRESSION" | "INVALID_REFERENCE" | "INVALID_ARGUMENT_INDEX";

/** A refusal from the expression layer, with a machine-readable `code`. */
export class RulesError extends Error {
  readonly code: RulesErrorCode;
  /** Where in the tree the refusal is, as argument indexes from the root. */
  readonly path: ExpressionPath;

  constructor(code: RulesErrorCode, message: string, path: ExpressionPath = []) {
    super(message);
    this.name = "RulesError";
    this.code = code;
    this.path = path;
  }
}

function refuse(code: RulesErrorCode, message: string, path: ExpressionPath = []): never {
  throw new RulesError(code, message, path);
}

/** How a path reads in a message, so a refusal points at a node. */
function describePath(path: ExpressionPath): string {
  return path.length === 0 ? "the expression" : `argument ${path.join(".")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The three kinds' own keys, used to remove one kind's keys when a node changes
 * kind. A node that changes from `ref` to `op` must not keep its `ref`: the
 * client's union has no member that carries both, and a document holding both
 * is one the core and this editor would read differently.
 */
const KIND_KEYS: Readonly<Record<ExpressionKind, readonly string[]>> = Object.freeze({
  ref: ["ref"],
  lit: ["lit"],
  op: ["op", "args"],
});

/** What kind of node `value` is, or `null` when it is not an expression node. */
export function expressionKind(value: unknown): ExpressionKind | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value["ref"] === "string") {
    return "ref";
  }
  if ("lit" in value) {
    return "lit";
  }
  if (typeof value["op"] === "string") {
    return "op";
  }
  return null;
}

/** A node's arguments, or an empty list for a node that has none. */
export function argumentsOf(node: ExpressionNode): unknown[] {
  const args = node["args"];
  return Array.isArray(args) ? args : [];
}

/** An `op` node's name, or `null` for a node that is not an `op`. */
export function operatorOf(node: ExpressionNode): string | null {
  const op = node["op"];
  return typeof op === "string" ? op : null;
}

/** A `ref` node's code, or `null` for a node that is not a `ref`. */
export function referencedCode(node: ExpressionNode): string | null {
  const ref = node["ref"];
  return typeof ref === "string" ? ref : null;
}

/** Whether a `ref` names a code no field in the document uses. */
export function isUnresolvedReference(
  node: ExpressionNode,
  knownCodes: ReadonlySet<string>,
): boolean {
  const code = referencedCode(node);
  return code !== null && !knownCodes.has(code);
}

/** A deep copy of a JSON value, written out rather than stringified. */
function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = cloneValue(entry);
    }
    return copy;
  }
  return value;
}

/**
 * A copy of an expression.
 *
 * Used where a tree is built from parts — `opNode` takes its arguments by copy
 * so a caller's array cannot be mutated through the node, and `insertArgument`
 * copies the argument it splices in for the same reason. Written structurally
 * on purpose: this module must not become a second place that turns a document
 * into text.
 */
export function cloneExpression(node: ExpressionNode): ExpressionNode {
  return cloneValue(node) as ExpressionNode;
}

/** A `{ ref }` node. */
export function refNode(code: string): ExpressionNode {
  return { ref: code };
}

/** A `{ lit }` node. `undefined` is not a value the client can carry. */
export function litNode(value: unknown): ExpressionNode {
  if (value === undefined) {
    refuse("INVALID_EXPRESSION", "A literal needs a value; undefined is not one.");
  }
  return { lit: value };
}

/**
 * An `{ op, args? }` node. `args` is written only when given, because `args`
 * is optional in the contract and an `op` with no arguments has a shorter and
 * more honest shape than `{ op, args: [] }`.
 */
export function opNode(name: string, args?: readonly ExpressionNode[]): ExpressionNode {
  if (args === undefined) {
    return { op: name };
  }
  return { op: name, args: args.map(cloneExpression) };
}

/** The node at `path`, or `null` when the path does not reach one. */
export function expressionAt(root: ExpressionNode, path: ExpressionPath): ExpressionNode | null {
  let current: unknown = root;
  for (const index of path) {
    if (expressionKind(current) !== "op") {
      return null;
    }
    const args = argumentsOf(current as ExpressionNode);
    if (index < 0 || index >= args.length) {
      return null;
    }
    current = args[index];
  }
  return isRecord(current) ? current : null;
}

/** The node at `path`, or a refusal saying the path reaches nothing. */
export function requireExpressionAt(root: ExpressionNode, path: ExpressionPath): ExpressionNode {
  const node = expressionAt(root, path);
  if (node === null) {
    refuse("INVALID_ARGUMENT_INDEX", `There is no expression at ${describePath(path)}.`, path);
  }
  return node;
}

/**
 * Write `next` onto the node at `path`, in place.
 *
 * The node object is **kept**: only the keys of the old kind and the keys `next`
 * does not carry are removed. Two properties follow, and both are the point.
 *
 * - A write cannot drop a key the editor does not model. An `op` node may carry
 *   a vendor key; writing its operator keeps that key, because the write is an
 *   assignment and not a projection.
 * - A node that changes kind does not keep the old kind's keys. `{ ref }`
 *   rewritten as `{ op }` must not end up holding both.
 *
 * The root is edited in place like any other node, which is what lets a builder
 * hold the live object {@link getFieldRule} returned. A *new* tree for a key
 * that is already there is the builder's decision, not a path edit.
 */
export function writeExpressionAt(
  root: ExpressionNode,
  path: ExpressionPath,
  next: ExpressionNode,
): void {
  const target = requireExpressionAt(root, path);
  const before = expressionKind(target);
  const after = expressionKind(next);
  if (after === null) {
    refuse(
      "INVALID_EXPRESSION",
      `The value written at ${describePath(path)} is not an expression.`,
      path,
    );
  }
  if (before !== null && before !== after) {
    for (const key of KIND_KEYS[before]) {
      delete target[key];
    }
  }
  if (after === "op" && next["args"] === undefined) {
    // An operator written with no arguments has no argument list.
    delete target["args"];
  }
  for (const [key, value] of Object.entries(next)) {
    target[key] = value;
  }
}

/** Replace the whole node at `path`. The root is replaced by the model, not here. */
export function replaceExpressionAt(
  root: ExpressionNode,
  path: ExpressionPath,
  next: ExpressionNode,
): void {
  writeExpressionAt(root, path, next);
}

/** Change a `ref` node's code, keeping the node and any unmodelled key. */
export function setReferencedCode(root: ExpressionNode, path: ExpressionPath, code: string): void {
  if (code.length === 0) {
    refuse(
      "INVALID_REFERENCE",
      "A reference needs a field code; an empty one names nothing.",
      path,
    );
  }
  writeExpressionAt(root, path, { ref: code });
}

/** Change an `op` node's operator. The argument list is left as it was. */
export function setOperator(root: ExpressionNode, path: ExpressionPath, name: string): void {
  if (name.length === 0) {
    refuse("INVALID_EXPRESSION", "An operator node needs a name.", path);
  }
  const target = requireExpressionAt(root, path);
  if (expressionKind(target) !== "op") {
    refuse("INVALID_EXPRESSION", `Only an op node has an operator; this one is not.`, path);
  }
  target["op"] = name;
}

/** Set a `lit` node's value. The value is cloned into the document. */
export function setLiteral(root: ExpressionNode, path: ExpressionPath, value: unknown): void {
  if (value === undefined) {
    refuse("INVALID_EXPRESSION", "A literal needs a value; undefined is not one.", path);
  }
  const target = requireExpressionAt(root, path);
  if (expressionKind(target) !== "lit") {
    refuse("INVALID_EXPRESSION", `Only a lit node has a value; this one is not.`, path);
  }
  target["lit"] = cloneValue(value);
}

/**
 * Turn the node at `path` into an `op`, with `args` when given.
 *
 * This is the node-kind control of the builder: the same action as "replace
 * this subtree", used when an author changes their mind about what an
 * expression is. Keys the old kind had are removed by {@link writeExpressionAt}.
 */
export function convertToOp(
  root: ExpressionNode,
  path: ExpressionPath,
  name: string,
  args?: readonly ExpressionNode[],
): void {
  if (name.length === 0) {
    refuse("INVALID_EXPRESSION", "An operator node needs a name.", path);
  }
  writeExpressionAt(root, path, opNode(name, args));
}

/** Turn the node at `path` into a `ref`. */
export function convertToRef(root: ExpressionNode, path: ExpressionPath, code: string): void {
  if (code.length === 0) {
    refuse(
      "INVALID_REFERENCE",
      "A reference needs a field code; an empty one names nothing.",
      path,
    );
  }
  writeExpressionAt(root, path, { ref: code });
}

/** Turn the node at `path` into a `lit`. */
export function convertToLit(root: ExpressionNode, path: ExpressionPath, value: unknown): void {
  if (value === undefined) {
    refuse("INVALID_EXPRESSION", "A literal needs a value; undefined is not one.", path);
  }
  writeExpressionAt(root, path, { lit: cloneValue(value) });
}

function requireArgsArray(root: ExpressionNode, path: ExpressionPath): unknown[] {
  const node = requireExpressionAt(root, path);
  if (expressionKind(node) !== "op") {
    refuse(
      "INVALID_EXPRESSION",
      `Only an op node has arguments; ${describePath(path)} is not.`,
      path,
    );
  }
  const args = node["args"];
  if (args === undefined) {
    const created: unknown[] = [];
    node["args"] = created;
    return created;
  }
  if (!Array.isArray(args)) {
    refuse("INVALID_EXPRESSION", `The args of ${describePath(path)} are not a list.`, path);
  }
  return args;
}

/**
 * Add an argument to the `op` at `path`.
 *
 * `at` defaults to the end. An index outside `0..args.length` is refused, in
 * the same code an out-of-range move or removal uses, so the builder has one
 * index error to draw.
 */
export function insertArgument(
  root: ExpressionNode,
  path: ExpressionPath,
  node: ExpressionNode,
  at?: number,
): void {
  if (expressionKind(node) === null) {
    refuse("INVALID_EXPRESSION", "An argument must itself be an expression.");
  }
  const args = requireArgsArray(root, path);
  const index = at ?? args.length;
  if (!Number.isInteger(index) || index < 0 || index > args.length) {
    refuse("INVALID_ARGUMENT_INDEX", `Index ${String(index)} is outside 0..${args.length}.`, path);
  }
  args.splice(index, 0, cloneExpression(node));
}

/**
 * Remove an argument. A `ref` or a `lit` has no arguments, so removing one
 * from them is refused rather than ignored.
 *
 * An emptied list stays as `[]` rather than being deleted: the operator is
 * still there, the author may be about to add a replacement, and deleting the
 * key would make the next add a different document.
 */
export function removeArgument(root: ExpressionNode, path: ExpressionPath, index: number): void {
  const args = requireArgsArray(root, path);
  if (!Number.isInteger(index) || index < 0 || index >= args.length) {
    refuse(
      "INVALID_ARGUMENT_INDEX",
      `Index ${String(index)} is outside 0..${args.length - 1}.`,
      path,
    );
  }
  args.splice(index, 1);
}

/**
 * Move an argument, which is how a wrong order gets fixed.
 *
 * `sub(a, b)` and `sub(b, a)` are different expressions with different
 * results, so reordering is a first-class edit and not something the builder
 * has to fake by rebuilding the whole tree. The index is measured **after** the
 * removal, exactly as `moveNode` measures a tree move, so "down one" from index
 * 0 is index 1 rather than index 0.
 */
export function moveArgument(
  root: ExpressionNode,
  path: ExpressionPath,
  from: number,
  to: number,
): void {
  const args = requireArgsArray(root, path);
  if (!Number.isInteger(from) || from < 0 || from >= args.length) {
    refuse(
      "INVALID_ARGUMENT_INDEX",
      `Index ${String(from)} is outside 0..${args.length - 1}.`,
      path,
    );
  }
  const limit = args.length - 1;
  if (!Number.isInteger(to) || to < 0 || to > limit) {
    refuse("INVALID_ARGUMENT_INDEX", `Index ${String(to)} is outside 0..${limit}.`, path);
  }
  if (from === to) {
    return;
  }
  const [moved] = args.splice(from, 1);
  args.splice(to, 0, moved);
}

/** One reference, and where it sits. */
export interface CollectedReference {
  readonly code: string;
  readonly path: ExpressionPath;
}

/**
 * Every `ref` in an expression, with its path.
 *
 * Reading only: a stored expression may name a code that does not exist, and
 * this walks through it so the builder can show *which* reference is
 * unresolved rather than only that the expression is.
 */
export function collectReferences(root: ExpressionNode): CollectedReference[] {
  const found: CollectedReference[] = [];
  const walk = (node: ExpressionNode, path: ExpressionPath): void => {
    if (expressionKind(node) === "ref") {
      const code = referencedCode(node);
      if (code !== null) {
        found.push({ code, path });
      }
      return;
    }
    if (expressionKind(node) === "op") {
      argumentsOf(node).forEach((argument, index) => {
        if (isRecord(argument)) {
          walk(argument, childPath(path, index));
        }
      });
    }
  };
  walk(root, []);
  return found;
}

/** The references of an expression that no field in the document answers to. */
export function unresolvedReferences(
  root: ExpressionNode,
  knownCodes: ReadonlySet<string>,
): CollectedReference[] {
  return collectReferences(root).filter((reference) => !knownCodes.has(reference.code));
}

/** A short, single-line rendering of an expression, for a collapsed row. */
export function describeExpression(node: ExpressionNode): string {
  const kind = expressionKind(node);
  if (kind === "ref") {
    return referencedCode(node) ?? "ref(?)";
  }
  if (kind === "lit") {
    return `lit ${JSON.stringify(node["lit"]) ?? "undefined"}`;
  }
  if (kind === "op") {
    const args = argumentsOf(node).map((argument) =>
      isRecord(argument) ? describeExpression(argument) : "…",
    );
    return `${operatorOf(node) ?? "?"}(${args.join(", ")})`;
  }
  return "not an expression";
}

/** How many nodes an expression holds, arguments included. */
export function expressionSize(node: ExpressionNode): number {
  if (expressionKind(node) === "op") {
    return (
      1 +
      argumentsOf(node).reduce<number>(
        (total, argument) => total + (isRecord(argument) ? expressionSize(argument) : 1),
        0,
      )
    );
  }
  return 1;
}

/** What {@link assertExpression} is allowed to check about references. */
export interface ExpressionCheck {
  /**
   * Whether a code names a field in the document.
   *
   * Supplied by the caller because this module knows nothing about documents.
   * When it is absent, no reference is checked — which is what *loading* wants,
   * because a stored expression is read as it is.
   */
  readonly isKnownCode?: (code: string) => boolean;
}

/**
 * Check that a value is an expression tree the client describes.
 *
 * `op` is **not** checked against any list: the contract types it as a string
 * and the core disposes of the ones it does not know. Structure is checked
 * (a node is a record, a `ref` a string, an `op` a string with a list of
 * expressions) and, when asked, references are checked against the document's
 * codes.
 *
 * A refusal is a {@link RulesError} with a path, so the model can turn it into
 * its own typed refusal and the builder can point at the offending node.
 */
export function assertExpression(value: unknown, check: ExpressionCheck = {}): void {
  const walk = (node: unknown, path: ExpressionPath): void => {
    if (!isRecord(node)) {
      refuse("INVALID_EXPRESSION", `An expression must be an object, not ${typeName(node)}.`, path);
    }
    const kind = expressionKind(node);
    if (kind === null) {
      refuse(
        "INVALID_EXPRESSION",
        `An expression is { ref }, { lit } or { op, args? }; this one has none of them.`,
        path,
      );
    }
    if (kind === "ref") {
      const code = referencedCode(node);
      if (code === null || code.length === 0) {
        refuse("INVALID_REFERENCE", "A ref needs a non-empty field code.", path);
      }
      if (check.isKnownCode !== undefined && !check.isKnownCode(code)) {
        refuse(
          "INVALID_REFERENCE",
          `No field in this document has the code ${JSON.stringify(code)}, so ${describePath(path)} names nothing.`,
          path,
        );
      }
      return;
    }
    if (kind === "lit") {
      // A literal is `unknown` on the wire, so anything goes, including null.
      return;
    }
    const args = node["args"];
    if (args === undefined) {
      return;
    }
    if (!Array.isArray(args)) {
      refuse("INVALID_EXPRESSION", `The args of ${describePath(path)} are not a list.`, path);
    }
    args.forEach((argument, index) => {
      walk(argument, childPath(path, index));
    });
  };
  walk(value, []);
}

function typeName(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "a list";
  }
  return typeof value;
}

/**
 * A literal as text, and the other way round.
 *
 * A literal is `unknown` on the wire, so the builder's text field is a JSON
 * value when it parses and a plain string when it does not: `42` is the number
 * 42, `true` is the boolean, and `two words` is the string. The alternative —
 * treating every literal as a string — would make it impossible to write the
 * number a `div` needs.
 */
export function parseLiteralText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** A literal as the text the builder's field shows. */
export function literalText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
