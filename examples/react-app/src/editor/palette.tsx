import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  addField,
  isContainerFieldType,
  nodeById,
  palette,
  type DocumentModel,
} from "@/editor/document-model";
import type { RunEdit } from "@/editor/editor-tree";

/**
 * The palette: every type a form may contain, and nothing else.
 *
 * The list is the model's own — `palette()` is the twelve, in the order the
 * core declares them — and this file restates none of it. Nine leaves and three
 * containers is a fact about the core, and a second copy of it here is a list
 * that would go stale the day a thirteenth type arrives. The split between the
 * two kinds is read with the model's own predicate too, so a badge that says
 * "container" is the model's word and not this file's.
 *
 * Legality is not decided here either. Whether a type may go under the selected
 * parent is the model's question and it is answered by `addField`, which
 * refuses with a code; the refusal is what the author reads. A palette that
 * filtered the illegal combinations itself would be a second rule book, and
 * would be wrong the moment the model's rules changed.
 *
 * A `component-ref` is the one type with a question attached: the model refuses
 * an add with no component, because a reference that names nothing cannot be
 * expanded and the document cannot compile. So the palette asks which component
 * before it offers the button, instead of adding a dead node and letting the
 * compile fail later.
 */

export interface EditorPaletteProps {
  readonly model: DocumentModel;
  /** The container being added into. `null` is the form's own field list. */
  readonly targetId: string | null;
  readonly onEdit: RunEdit;
  readonly onClose: () => void;
}

/** The name a type is offered under, derived from the type itself. */
function displayName(type: string): string {
  const leaf = type.replace(/-/g, " ");
  return leaf.charAt(0).toUpperCase() + leaf.slice(1);
}

/** Where the add is going, stated in words rather than implied. */
function targetLabel(model: DocumentModel, targetId: string | null): string {
  if (targetId === null) {
    return "the top level of this form";
  }
  const target = nodeById(model, targetId);
  if (target === null) {
    return "a field that is no longer in this document";
  }
  const title = target.raw["title"];
  const name = typeof title === "string" && title.length > 0 ? title : target.id;
  return `inside ${target.type} “${name}”`;
}

export function EditorPalette({ model, targetId, onEdit, onClose }: EditorPaletteProps) {
  const [componentCode, setComponentCode] = useState("");
  const [componentVersion, setComponentVersion] = useState("");

  const add = (type: string, component?: { componentCode: string; componentVersion?: string }) => {
    onEdit(() => {
      addField(model, type, targetId, {
        label: displayName(type),
        ...(component === undefined ? {} : { component }),
      });
    });
  };

  const componentReady = componentCode.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle>Palette</CardTitle>
            <CardDescription>
              The twelve types, in the core&rsquo;s own order. Adding into{" "}
              {targetLabel(model, targetId)}.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Close the palette"
            onClick={onClose}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldSet>
          <FieldLegend variant="label" className="text-muted-foreground">
            Fields
          </FieldLegend>
          <div className="flex flex-wrap gap-2">
            {palette()
              .filter((type) => !isContainerFieldType(type))
              .map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    add(type);
                  }}
                >
                  <PlusIcon aria-hidden="true" />
                  {displayName(type)}
                </Button>
              ))}
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label" className="text-muted-foreground">
            Containers
          </FieldLegend>
          <div className="flex flex-wrap gap-2">
            {palette()
              .filter((type) => isContainerFieldType(type) && type !== "component-ref")
              .map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    add(type);
                  }}
                >
                  <PlusIcon aria-hidden="true" />
                  {displayName(type)}
                </Button>
              ))}
            <Badge variant="secondary" className="self-center">
              no answer of their own
            </Badge>
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Component reference</FieldLegend>
          <p className="text-sm text-muted-foreground">
            A component reference names a component, and a reference that names nothing is a shape
            the core cannot expand. Name the component here and the model writes both the reference
            and the target in one add.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="editor-palette-component-code">Component code</FieldLabel>
              <Input
                id="editor-palette-component-code"
                value={componentCode}
                placeholder="address-card"
                onChange={(event) => {
                  setComponentCode(event.currentTarget.value);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="editor-palette-component-version">Version (optional)</FieldLabel>
              <Input
                id="editor-palette-component-version"
                value={componentVersion}
                placeholder="1.0.0"
                onChange={(event) => {
                  setComponentVersion(event.currentTarget.value);
                }}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={!componentReady}
            onClick={() => {
              const version = componentVersion.trim();
              add("component-ref", {
                componentCode: componentCode.trim(),
                ...(version.length > 0 ? { componentVersion: version } : {}),
              });
            }}
          >
            <PlusIcon aria-hidden="true" />
            Add component reference
          </Button>
        </FieldSet>
      </CardContent>
    </Card>
  );
}
