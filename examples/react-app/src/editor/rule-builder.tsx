import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  fieldRulesFor,
  knownCodeSet,
  orphanedRuleFields,
  setFieldRule,
  type DocumentModel,
  type EditorNode,
} from "@/editor/document-model";
import type { RunEdit } from "@/editor/editor-tree";
import {
  argumentsOf,
  describeExpression,
  expressionAt,
  expressionKind,
  insertArgument,
  isObservedOperator,
  isUnresolvedReference,
  literalText,
  litNode,
  moveArgument,
  opNode,
  parseLiteralText,
  referencedCode,
  refNode,
  removeArgument,
  setLiteral,
  setOperator,
  setReferencedCode,
  convertToLit,
  convertToOp,
  convertToRef,
  OBSERVED_OPERATORS,
  type ExpressionNode,
  type ExpressionPath,
  type FieldRuleKey,
} from "@/editor/rules";

/**
 * The rule builder: the four keys of one field's rules, as four **trees**.
 *
 * Four decisions here are the whole design, and none of them is a widget
 * choice.
 *
 * 1. **A rule is a tree, not a string.** An `op`'s arguments are ordered and
 *    order is meaning — `sub(a, b)` is not `sub(b, a)` — so removing,
 *    reordering and replacing an argument are three separate edits with three
 *    separate controls, rather than three consequences of retyping a line of
 *    JSON. This is the same reasoning as the tree's explicit move arrows
 *    existing beside the drag: the mistake is real, and it needs its own
 *    control.
 * 2. **The operator field is free text with suggestions.** The operator
 *    vocabulary is not in the type system, so the `datalist` offers the set this
 *    repository's corpora use and the field accepts anything else. A builder
 *    that validated a name against its own list would be unable to describe a
 *    document the core accepts, and the core's own answer — refused at compile,
 *    surfaced through the `schemaCheck` the API returns — is better than a
 *    guess made in the browser. So the field does not gate, and the two places
 *    that *are* told something — the suggestion list, and this file's comment —
 *    say plainly that the list is observed.
 * 3. **A `ref` may only name a code the document has.** The field offers the
 *    document's codes and the model refuses a write naming anything else, so the
 *    builder cannot invent a reference to nothing. A *stored* reference to a
 *    field that has since been removed is a different case: it is shown, marked
 *    unresolved, and never rewritten — the editor has no basis for guessing
 *    which field the author meant.
 * 4. **Orphaned rules are surfaced here, and not in the tree.** The notice lives
 *    in this panel because this is the only panel whose subject is the rules
 *    document *as a whole*: an orphan is a rule whose field is gone, so the tree
 *    has no row to select and a per-field panel could never show it. Hiding it
 *    would be the alternative, and hiding it is what makes a rule look deleted
 *    when it is only unreachable — the author would have no way to tell a rule
 *    they wrote from one that was thrown away.
 */

export interface RuleBuilderProps {
  readonly model: DocumentModel;
  /** The field whose rules are being edited, or `null` when none is selected. */
  readonly node: EditorNode | null;
  readonly onEdit: RunEdit;
}

function domId(id: string, suffix: string): string {
  return `editor-rule-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${suffix}`;
}

/** The suggestion list's DOM id. `datalist` needs one, and it needs it unique. */
function operatorListId(fieldId: string): string {
  return domId(fieldId, "operators");
}

function codeListId(fieldId: string): string {
  return domId(fieldId, "codes");
}

/**
 * The first edit to a key that has no expression yet.
 *
 * It is a starting point, not a decision, and it is chosen so the *first write
 * is legal*: a `ref` may only name a code the document has, so the seed takes
 * the first one it does, and it takes `eq` from the observed list because an
 * `op` with no arguments is the one shape that is valid in every position. The
 * author replaces both in the first second of editing; the builder never picks
 * anything it cannot show.
 */
function seedExpression(model: DocumentModel): ExpressionNode {
  const first = knownCodeSet(model);
  const code = [...first][0];
  return code === undefined ? opNode("eq") : opNode("eq", [refNode(code)]);
}

/** One `datalist` of the observed operators, rendered once per builder. */
function OperatorSuggestions({ fieldId }: { fieldId: string }) {
  return (
    <datalist id={operatorListId(fieldId)}>
      {OBSERVED_OPERATORS.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}

/** The three kinds a node can be, as a small segmented control. */
function KindSwitch({
  kind,
  onConvert,
}: {
  kind: "ref" | "lit" | "op";
  onConvert: (next: "ref" | "lit" | "op") => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {(["op", "ref", "lit"] as const).map((option) => (
        <Button
          key={option}
          type="button"
          variant={kind === option ? "secondary" : "ghost"}
          size="xs"
          aria-pressed={kind === option}
          onClick={() => {
            if (kind !== option) {
              onConvert(option);
            }
          }}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}

/**
 * One node of the tree, and its arguments below it.
 *
 * Every edit goes to `onEdit` as a closure that mutates the live tree and
 * writes it back through `setFieldRule`, so the refusal the model may give —
 * a `ref` to a code that is not there, an index outside the argument list —
 * arrives through the same channel as every other edit in the editor and is
 * drawn in the same place, rather than being caught and reworded here.
 */
function ExpressionEditor({
  model,
  fieldId,
  ruleKey,
  expression,
  path,
  knownCodes,
  onEdit,
}: {
  model: DocumentModel;
  fieldId: string;
  ruleKey: FieldRuleKey;
  expression: ExpressionNode;
  path: ExpressionPath;
  knownCodes: ReadonlySet<string>;
  onEdit: RunEdit;
}) {
  const node = expressionAt(expression, path) ?? expression;
  const kind = expressionKind(node) ?? "op";
  const id = `${domId(fieldId, ruleKey)}-${path.join("-") || "root"}`;
  const childId = `${id}-children`;

  /** Mutate the live tree at `path`, then write it back. */
  const write = (action: () => void) => {
    onEdit(() => {
      action();
      setFieldRule(model, fieldId, ruleKey, expression);
    });
  };

  const operatorName = typeof node["op"] === "string" ? node["op"] : "";

  return (
    <div className="flex flex-col gap-2" data-path={path.join(".") || "root"}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {path.length === 0 ? "expression" : `argument ${path.join(".")}`}
        </span>
        <KindSwitch
          kind={kind}
          onConvert={(next) => {
            write(() => {
              if (next === "op") {
                convertToOp(expression, path, "eq");
              } else if (next === "ref") {
                convertToRef(expression, path, [...knownCodes][0] ?? "");
              } else {
                convertToLit(expression, path, null);
              }
            });
          }}
        />
      </div>

      {kind === "op" ? (
        <Field className="gap-1">
          <FieldLabel htmlFor={id} className="text-xs">
            operator
          </FieldLabel>
          <Input
            id={id}
            list={operatorListId(fieldId)}
            className="font-mono"
            value={operatorName}
            onChange={(event) => {
              const text = event.currentTarget.value;
              // Written as typed. The suggestions beside the field are a
              // convenience, not a gate, and nothing here asks whether the core
              // has heard of this name.
              write(() => {
                setOperator(expression, path, text);
              });
            }}
          />
          <FieldDescription className="text-xs">
            {isObservedOperator(operatorName) ? (
              <>
                One this repository&rsquo;s samples use. The list is observed, not a declared
                vocabulary.
              </>
            ) : (
              <>
                Not in this repository&rsquo;s observed set. That is not a refusal: <code>op</code>{" "}
                is a string in the contract, so an operator the core knows and this editor has not
                seen stays expressible. The core decides at compile, and the editor shows that
                answer through the schema check.
              </>
            )}
          </FieldDescription>
        </Field>
      ) : null}

      {kind === "ref" ? (
        <Field className="gap-1">
          <FieldLabel htmlFor={id} className="text-xs">
            field code
          </FieldLabel>
          <Input
            id={id}
            list={codeListId(fieldId)}
            className="font-mono"
            aria-invalid={isUnresolvedReference(node, knownCodes)}
            value={referencedCode(node) ?? ""}
            onChange={(event) => {
              const text = event.currentTarget.value;
              write(() => {
                setReferencedCode(expression, path, text);
              });
            }}
          />
          {isUnresolvedReference(node, knownCodes) ? (
            <FieldDescription className="text-xs text-destructive">
              No field in this document has the code{" "}
              <span className="font-mono">{referencedCode(node)}</span>. It is shown as stored and
              is not rewritten: nothing here knows which field was meant.
            </FieldDescription>
          ) : (
            <FieldDescription className="text-xs">
              One of the {knownCodes.size} codes in this form. A reference to a code that does not
              exist is refused on write, so the builder cannot invent one.
            </FieldDescription>
          )}
        </Field>
      ) : null}

      {kind === "lit" ? (
        <Field className="gap-1">
          <FieldLabel htmlFor={id} className="text-xs">
            literal
          </FieldLabel>
          <Input
            id={id}
            className="font-mono"
            value={literalText(node["lit"])}
            onChange={(event) => {
              const text = event.currentTarget.value;
              write(() => {
                setLiteral(expression, path, parseLiteralText(text));
              });
            }}
          />
          <FieldDescription className="text-xs">
            Read as JSON when it parses and as text when it does not:{" "}
            <span className="font-mono">42</span> is the number,{" "}
            <span className="font-mono">two words</span> is the string.
          </FieldDescription>
        </Field>
      ) : null}

      {kind === "op" ? (
        <div className="flex flex-col gap-2" id={childId}>
          {argumentsOf(node).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This operator has no arguments.{" "}
              <span className="font-mono">{operatorName || "?"}</span> is written without an
              argument list, which the contract allows.
            </p>
          ) : (
            argumentsOf(node).map((_argument, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-md border border-border/60 p-2"
                style={{ marginLeft: `${Math.min(path.length, 4) * 12}px` }}
              >
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">argument {index + 1}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={index === 0}
                      aria-label={`Move argument ${index + 1} up`}
                      onClick={() => {
                        write(() => {
                          moveArgument(expression, path, index, index - 1);
                        });
                      }}
                    >
                      <ArrowUpIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={index === argumentsOf(node).length - 1}
                      aria-label={`Move argument ${index + 1} down`}
                      onClick={() => {
                        write(() => {
                          moveArgument(expression, path, index, index + 1);
                        });
                      }}
                    >
                      <ArrowDownIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-destructive"
                      aria-label={`Remove argument ${index + 1}`}
                      onClick={() => {
                        write(() => {
                          removeArgument(expression, path, index);
                        });
                      }}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <ExpressionEditor
                  model={model}
                  fieldId={fieldId}
                  ruleKey={ruleKey}
                  expression={expression}
                  path={[...path, index]}
                  knownCodes={knownCodes}
                  onEdit={onEdit}
                />
              </div>
            ))
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                write(() => {
                  // Appended as a literal null: the only argument that is always
                  // legal, and one keystroke from whatever the author wants.
                  insertArgument(expression, path, litNode(null));
                });
              }}
            >
              <PlusIcon aria-hidden="true" />
              Add argument
            </Button>
            <span className="text-xs text-muted-foreground">
              Arguments are ordered, and the order is meaning: {describeExpression(node)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One of the four keys, labelled by what it means. */
function RuleRow({
  model,
  fieldId,
  row,
  knownCodes,
  onEdit,
}: {
  model: DocumentModel;
  fieldId: string;
  row: ReturnType<typeof fieldRulesFor>[number];
  knownCodes: ReadonlySet<string>;
  onEdit: RunEdit;
}) {
  const id = domId(fieldId, row.key);
  const expression = row.expression;
  return (
    <div className="flex flex-col gap-2" data-rule-key={row.key}>
      <div className="flex flex-wrap items-center gap-2">
        <FieldLabel htmlFor={id} className="font-mono text-sm">
          {row.label}
        </FieldLabel>
        {/* The three conditions are booleans; `calculate` produces a value, and
            an author reading it as "when" is reading it wrong. The badge is the
            difference, on every row, rather than four identical text boxes. */}
        <Badge variant={row.kind === "condition" ? "outline" : "secondary"}>
          {row.kind === "condition" ? "condition · yes or no" : "value · not a yes or no"}
        </Badge>
        {expression === null ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="ml-auto"
            onClick={() => {
              onEdit(() => {
                setFieldRule(model, fieldId, row.key, seedExpression(model));
              });
            }}
          >
            <PlusIcon aria-hidden="true" />
            Add
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto text-destructive"
            onClick={() => {
              onEdit(() => {
                // Absence, not a `null`: the contract allows the key to be gone,
                // and a document that grows a `null` is a different document.
                setFieldRule(model, fieldId, row.key, null);
              });
            }}
          >
            <Trash2Icon aria-hidden="true" />
            Remove rule
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{row.meaning}</p>
      {expression === null ? null : (
        <ExpressionEditor
          model={model}
          fieldId={fieldId}
          ruleKey={row.key}
          expression={expression}
          path={[]}
          knownCodes={knownCodes}
          onEdit={onEdit}
        />
      )}
    </div>
  );
}

/**
 * Rules whose field the form document no longer has.
 *
 * Drawn here rather than in the tree, and rather than in the selected field's
 * panel, because an orphan has no field: the tree draws rows for fields, and a
 * field that is gone has no row, so any notice attached to the selection would
 * itself be unreachable. The rules panel is the only place in the editor whose
 * subject is the rules document as a whole.
 *
 * The rules are **kept**. `removeNode` deliberately leaves them, and deleting
 * one here would be the editor throwing away something the author wrote on the
 * strength of a field they might be about to add back.
 */
function OrphanedRules({ model }: { model: DocumentModel }) {
  const orphans = orphanedRuleFields(model);
  if (orphans.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/60 p-3">
      <div className="flex items-center gap-2">
        <Badge variant="destructive">orphaned rules</Badge>
        <span className="text-xs text-muted-foreground">
          {orphans.length} {orphans.length === 1 ? "field has" : "fields have"} rules but are not in
          this form
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-xs">
        {orphans.map((fieldId) => (
          <li key={fieldId} className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{fieldId}</span>
            <span className="text-muted-foreground">{describeOrphan(model, fieldId)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        A removed field leaves its rules alone on purpose: a rule the author wrote is not the
        editor&rsquo;s to throw away. The rules stay in the document and are shown here so they are
        not silently unreachable — add the field back, or remove the rule by hand in the stored
        text.
      </p>
    </div>
  );
}

/** The keys an orphaned entry carries, so the notice says what is stranded. */
function describeOrphan(model: DocumentModel, fieldId: string): string {
  const fields = model.rules?.["fields"];
  if (typeof fields !== "object" || fields === null) {
    return "no keys to show";
  }
  const entry = (fields as Record<string, unknown>)[fieldId];
  if (typeof entry !== "object" || entry === null) {
    return "no keys to show";
  }
  const keys = Object.keys(entry as Record<string, unknown>);
  return keys.length === 0 ? "an entry with no keys" : `carries ${keys.join(", ")}`;
}

/**
 * The whole rules panel: the orphan notice, and the four keys of the selected
 * field.
 *
 * The orphan notice is drawn whether or not a field is selected, which is the
 * point of it: with nothing selected the rules document is the only thing this
 * panel is about.
 */
export function RuleBuilder({ model, node, onEdit }: RuleBuilderProps) {
  const knownCodes = knownCodeSet(model);
  const rows = node === null ? [] : fieldRulesFor(model, node.id);
  const fieldId = node?.id ?? "none";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Rules</p>
        <p className="text-xs text-muted-foreground">
          Four keys, keyed by field id: visibleWhen, enabledWhen, requiredWhen and calculate. They
          are the only rule keys <code>FieldRules</code> carries, and an expression is a tree of{" "}
          <span className="font-mono">{"ref"}</span>, <span className="font-mono">lit</span> and{" "}
          <span className="font-mono">op</span>, not a line of text.
        </p>
      </div>

      <OrphanedRules model={model} />

      {node === null ? (
        <p className="text-xs text-muted-foreground">
          Select a field to edit its rules. The operators this repository&rsquo;s samples use are
          offered as suggestions: {OBSERVED_OPERATORS.join(", ")}. Any other name is accepted — the
          vocabulary is not in the type system, and the core is what refuses an operator it does not
          know.
        </p>
      ) : (
        <>
          <OperatorSuggestions fieldId={fieldId} />
          <datalist id={codeListId(fieldId)}>
            {[...knownCodes].map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
          {rows.map((row) => (
            <RuleRow
              key={row.key}
              model={model}
              fieldId={node.id}
              row={row}
              knownCodes={knownCodes}
              onEdit={onEdit}
            />
          ))}
        </>
      )}
    </div>
  );
}
