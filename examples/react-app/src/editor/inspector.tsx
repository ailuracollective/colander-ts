import type { FieldOption } from "@ailura/colander-client";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  editablePropertiesFor,
  getComponentRefProperty,
  getNodeProperty,
  isContainerFieldType,
  isHiddenInUi,
  rulesEntryFor,
  setComponentRefProperty,
  setNodeProperty,
  uiEntryFor,
  COMPONENT_REF_PROPERTIES,
  type DocumentModel,
  type EditableProperty,
  type EditablePropertyValue,
  type EditorNode,
} from "@/editor/document-model";
import type { RunEdit } from "@/editor/editor-tree";
import { RuleBuilder } from "@/editor/rule-builder";

/**
 * The inspector: the selected node's properties, as the model declares them.
 *
 * There is no `switch` over nine types here, and that is the point of the file.
 * The model's own table says which properties each type has, in table order, so
 * the inspector asks {@link editablePropertiesFor} and draws a row per answer.
 * A property a type does not have is therefore not rendered, not hidden, and
 * not disabled: there is no path in this file that could write one, because the
 * only way to name a property is to read it out of the table. Hand-writing nine
 * cases would put a second copy of the table in the UI, and the two copies
 * would disagree the first time the model gained a property.
 *
 * `PROPERTY_INPUT_KINDS` is the one thing this file does restate: the wire kind
 * of each property, which the model keeps private because no caller needs it.
 * It is a widget choice, not a type rule — a number row is a number input for
 * every type that has one — and it is checked against the model on every write,
 * so a disagreement shows up as a refusal rather than as a bad document.
 */

export interface EditorInspectorProps {
  readonly model: DocumentModel;
  readonly node: EditorNode | null;
  readonly onEdit: RunEdit;
}

type PropertyInputKind = "text" | "number" | "boolean" | "options";

/** The widget a property is edited with, mirroring the model's private table. */
const PROPERTY_INPUT_KINDS: Readonly<Record<EditableProperty, PropertyInputKind>> = Object.freeze({
  title: "text",
  description: "text",
  pattern: "text",
  required: "boolean",
  readOnly: "boolean",
  minLength: "number",
  maxLength: "number",
  minimum: "number",
  maximum: "number",
  multipleOf: "number",
  decimalPlaces: "number",
  minItems: "number",
  maxItems: "number",
  allowMultiple: "boolean",
  options: "options",
});

/** A long text property is a textarea and a short one is an input. */
const LONG_TEXT_PROPERTIES: ReadonlySet<EditableProperty> = new Set<EditableProperty>([
  "description",
  "pattern",
]);

function inputId(node: EditorNode, property: string): string {
  return `editor-property-${node.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${property}`;
}

/** The DOM id of one row of the options list. */
function optionId(node: EditorNode, index: number, half: "value" | "label"): string {
  return `${inputId(node, "option")}-${index}-${half}`;
}

/** The property's current value, as text, for the text and number widgets. */
function asText(value: EditablePropertyValue): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

function optionsOf(value: unknown): readonly FieldOption[] {
  return Array.isArray(value) ? (value as readonly FieldOption[]) : [];
}

/**
 * A value no existing option uses, for a new row of the list.
 *
 * The model refuses a property value it does not recognise, and it does not
 * police option uniqueness, so the walk is here rather than in a refusal the
 * author would have to interpret. It picks a name; the write still goes through
 * the model.
 */
function nextOptionValue(options: readonly FieldOption[]): string {
  const taken = new Set(options.map((option) => option.value));
  let candidate = "option";
  let suffix = 1;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `option-${suffix}`;
  }
  return candidate;
}

/**
 * The `choice` options list.
 *
 * The whole list is written on every change, through the model, because that is
 * the one shape the model accepts for `options`. An option is `{ value, label? }`
 * and a label left empty stays absent rather than becoming `""`.
 */
function OptionsEditor({ node, onEdit }: { node: EditorNode; onEdit: RunEdit }) {
  const options = optionsOf(getNodeProperty(node, "options"));

  const write = (next: readonly FieldOption[]) => {
    onEdit(() => {
      setNodeProperty(node, "options", next);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No options yet. A choice with no options can never be answered.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {options.map((option, index) => (
            // Keyed by position, not by value: the value is being typed into, and
            // a key that changes with it would remount the input on every
            // keystroke and drop the caret. The list cannot be reordered, so a
            // position is a stable identity here.
            <li key={index} className="flex items-end gap-2">
              <Field className="gap-1">
                <FieldLabel htmlFor={optionId(node, index, "value")} className="text-xs">
                  Value
                </FieldLabel>
                <Input
                  id={optionId(node, index, "value")}
                  value={option.value}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    write(
                      options.map((current, at) =>
                        at === index ? { ...current, value } : current,
                      ),
                    );
                  }}
                />
              </Field>
              <Field className="gap-1">
                <FieldLabel htmlFor={optionId(node, index, "label")} className="text-xs">
                  Label
                </FieldLabel>
                <Input
                  id={optionId(node, index, "label")}
                  value={option.label ?? ""}
                  placeholder={option.value}
                  onChange={(event) => {
                    const label = event.currentTarget.value;
                    write(
                      options.map((current, at) => {
                        if (at !== index) {
                          return current;
                        }
                        const { label: _dropped, ...rest } = current;
                        return label.length === 0 ? rest : { ...rest, label };
                      }),
                    );
                  }}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-destructive"
                aria-label={`Remove option ${option.value}`}
                onClick={() => {
                  write(options.filter((_current, at) => at !== index));
                }}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => {
          const value = nextOptionValue(options);
          write([...options, { value }]);
        }}
      >
        <PlusIcon aria-hidden="true" />
        Add option
      </Button>
    </div>
  );
}

/** One property row, drawn with the widget its kind calls for. */
function PropertyRow({
  node,
  property,
  onEdit,
}: {
  node: EditorNode;
  property: EditableProperty;
  onEdit: RunEdit;
}) {
  const kind = PROPERTY_INPUT_KINDS[property];
  const value = getNodeProperty(node, property);
  const id = inputId(node, property);

  const write = (next: string | number | boolean | readonly FieldOption[] | null) => {
    onEdit(() => {
      setNodeProperty(node, property, next);
    });
  };

  if (kind === "options") {
    return (
      <Field className="gap-1">
        <FieldLabel htmlFor={id}>{property}</FieldLabel>
        <FieldDescription>
          The only answer the core holds as a list. Every change writes the whole list.
        </FieldDescription>
        <OptionsEditor node={node} onEdit={onEdit} />
      </Field>
    );
  }

  if (kind === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => {
            write(checked === true);
          }}
        />
        <FieldLabel htmlFor={id}>{property}</FieldLabel>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {value === true ? "true" : "unset"}
        </span>
      </div>
    );
  }

  if (kind === "number") {
    return (
      <Field className="gap-1">
        <FieldLabel htmlFor={id}>{property}</FieldLabel>
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={asText(value)}
          onChange={(event) => {
            const text = event.currentTarget.value.trim();
            if (text.length === 0) {
              // An empty bound is no bound, and the model removes the key.
              write(null);
              return;
            }
            // A value that is not a finite number is handed to the model as
            // typed, so the refusal is the model's message and not a guess
            // this file made about what the author meant.
            write(Number(text));
          }}
        />
      </Field>
    );
  }

  const long = LONG_TEXT_PROPERTIES.has(property);
  return (
    <Field className="gap-1">
      <FieldLabel htmlFor={id}>{property}</FieldLabel>
      {long ? (
        <Textarea
          id={id}
          value={asText(value)}
          rows={property === "description" ? 3 : 1}
          onChange={(event) => {
            const text = event.currentTarget.value;
            write(text.length === 0 ? null : text);
          }}
        />
      ) : (
        <Input
          id={id}
          value={asText(value)}
          onChange={(event) => {
            const text = event.currentTarget.value;
            write(text.length === 0 ? null : text);
          }}
        />
      )}
    </Field>
  );
}

/**
 * The component a `component-ref` names.
 *
 * These two keys are not control properties: they are keys of the field
 * document, which is why they are a table of their own in the model and get
 * their own readers and writers here. Clearing either is refused by the model
 * on purpose — an emptied `componentCode` turns a node that compiles into one
 * that names nothing — so the field is not clearable and says so.
 */
function ComponentTargetEditor({ node, onEdit }: { node: EditorNode; onEdit: RunEdit }) {
  return (
    <>
      {COMPONENT_REF_PROPERTIES.map((property) => {
        const id = inputId(node, property);
        return (
          <Field key={property} className="gap-1">
            <FieldLabel htmlFor={id}>{property}</FieldLabel>
            <Input
              id={id}
              value={getComponentRefProperty(node, property) ?? ""}
              onChange={(event) => {
                const text = event.currentTarget.value.trim();
                if (text.length === 0) {
                  return;
                }
                onEdit(() => {
                  setComponentRefProperty(node, property, text);
                });
              }}
            />
          </Field>
        );
      })}
    </>
  );
}

/** What the document says about this node outside the form document. */
function DocumentFacts({ model, node }: { model: DocumentModel; node: EditorNode }) {
  const ui = uiEntryFor(model, node.id);
  const rules = rulesEntryFor(model, node.id);
  const hidden = isHiddenInUi(model, node.id);
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p className="flex items-center gap-2">
        <Badge variant="outline">ui</Badge>
        {ui === null ? "no entry in the ui document" : "has a ui entry"}
        {hidden ? " · hidden" : ""}
      </p>
      <p className="flex items-center gap-2">
        <Badge variant="outline">rules</Badge>
        {rules === null ? "no rules for this field" : "has rules"}
      </p>
      <p>
        The rules themselves are edited below, as expression trees rather than as text. The four
        keys are keyed by field id, and they are the only ones{" "}
        <span className="font-mono">FieldRules</span> carries.
      </p>
    </div>
  );
}

export function EditorInspector({ model, node, onEdit }: EditorInspectorProps) {
  if (node === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inspector</CardTitle>
          <CardDescription>
            Select a field in the tree to edit what its type declares.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">
            Nothing is selected. The tree draws a leaf through the same control the form will use,
            and this panel edits the properties behind it. The rules panel below still has something
            to say: a rule whose field is gone is visible from here and from nowhere else.
          </p>
          <RuleBuilder model={model} node={null} onEdit={onEdit} />
        </CardContent>
      </Card>
    );
  }

  const properties = editablePropertiesFor(node.type);
  const allowMultiple = getNodeProperty(node, "allowMultiple") === true;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Inspector</CardTitle>
          <Badge variant={isContainerFieldType(node.type) ? "secondary" : "outline"}>
            {node.type}
          </Badge>
        </div>
        <CardDescription>
          <span className="font-mono">{node.code.length > 0 ? node.code : node.id}</span> · id{" "}
          <span className="font-mono">{node.id}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-4">
          {properties.map((property) => (
            <PropertyRow key={property} node={node} property={property} onEdit={onEdit} />
          ))}
        </div>

        {allowMultiple ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">allowMultiple is on.</span> The contract
            accepts it and the core enforces the multi-answer shape, but this application&rsquo;s
            choice control draws one value. A multi-select needs a list-holding widget before it can
            be honest.
          </p>
        ) : null}

        {node.type === "component-ref" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Component</p>
            <ComponentTargetEditor node={node} onEdit={onEdit} />
            <p className="text-xs text-muted-foreground">
              Both keys are required to be non-empty. The model refuses an empty one rather than
              writing a reference that names nothing.
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">In the rest of the document</p>
          <DocumentFacts model={model} node={node} />
        </div>

        <RuleBuilder model={model} node={node} onEdit={onEdit} />

        <p className="text-xs text-muted-foreground">
          These are the {properties.length} properties the model says a {node.type} can carry, in
          its own order. A property outside this list cannot be written from here, because the list
          is the model&rsquo;s table and not a switch in this file.
        </p>
      </CardContent>
    </Card>
  );
}
