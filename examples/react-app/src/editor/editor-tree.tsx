import type { FieldOption } from "@ailura/colander-client";
import { renderColanderField } from "@ailura/colander-compiler/runtime";
import { unansweredValueFor } from "@ailura/colander-compiler/utilities";
import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";

import * as controls from "@/components/colander";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import {
  getComponentRefProperty,
  getNodeProperty,
  isContainerFieldType,
  isMaterializableFieldType,
  moveNode,
  removeNode,
  type DocumentModel,
  type EditablePropertyValue,
  type EditorModelErrorCode,
  type EditorNode,
} from "@/editor/document-model";
import {
  DragAnnouncer,
  DragHandle,
  DropZone,
  nodeName,
  type EditorDrag,
  type EditorDropTarget,
} from "@/editor/drag-and-drop";

/**
 * The tree: the document as the author sees it while building it.
 *
 * Three things this file is careful about, and none of them are styling.
 *
 * 1. **A leaf draws through the same control it will draw through at runtime.**
 *    {@link renderColanderField} and `controls.shell` are the runtime's own
 *    path, so a field's label, description and frame in the editor are the
 *    runtime's label, description and frame. There is no second field widget
 *    here to drift from the one the form will use.
 * 2. **A container and a leaf do not look alike.** A container is a
 *    `FieldSet` with a legend and its children inside; a leaf is the shell
 *    around one control, with no box around it. The section treatment — the
 *    legend levels, the separators between sibling sections — mirrors
 *    `form-runner.tsx`, so the editor and the runner are one visual language.
 * 3. **Editing is explicit, and a drag is an addition to it.** Every change
 *    here is a button, and every button hands the work to the model, which
 *    either does it or refuses with a code. A refusal is drawn next to the node
 *    it is about, never swallowed. Drag and drop sits beside those buttons and
 *    does not replace one of them: the arrows are the plainest way to reorder,
 *    and a drag is a second way to do the same thing, with a pointer *or* from
 *    the keyboard -- see {@link DragHandle}.
 */

/** A refusal, carried up from the model and drawn where it happened. */
export interface EditorRefusal {
  readonly code: EditorModelErrorCode;
  readonly message: string;
  readonly fieldId: string | null;
}

/**
 * Runs one model call, showing a refusal rather than throwing it away.
 *
 * Returns whether the model accepted the edit, which is what lets the route say
 * what a drop *did* after the fact: a refusal is announced in the model's own
 * words and no outcome sentence follows it, and an accepted edit gets the
 * outcome the route can actually observe.
 */
export type RunEdit = (action: () => void) => boolean;

export interface EditorTreeProps {
  readonly model: DocumentModel;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  /** Move the palette's add target to this container, or to the root. */
  readonly onAddTarget: (parentId: string | null) => void;
  /**
   * The drag the route is holding, and where it currently points.
   *
   * Held by the route beside `selectedId` and passed down beside it, in the
   * same plain-props way. A drag is a piece of interaction state, not a
   * document fact, so it does not belong in the model; and a context would hide
   * it from every reader of this file's props, which is the opposite of what
   * this tree does with everything else.
   */
  readonly drag: EditorDrag | null;
  readonly onDragStart: (id: string) => void;
  readonly onDragOver: (target: EditorDropTarget | null) => void;
  readonly onDragEnd: () => void;
  /** The route attempts the move; whether the model agrees is not asked here. */
  readonly onDrop: (target: EditorDropTarget) => void;
  /** The sentence a keyboard drag last announced, read out by a live region. */
  readonly announcement: string;
  readonly onAnnounce: (message: string) => void;
  readonly onEdit: RunEdit;
  readonly refusal: EditorRefusal | null;
}

function domId(id: string): string {
  return `editor-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/**
 * A section title, at the level its depth calls for.
 *
 * The three levels and the step down between them are the runner's, copied
 * because that file keeps them private: a top-level section leads, a nested one
 * is a label inside its parent, and a third level reads as secondary. Without
 * the third step a container and its first child would be the same words at the
 * same size, and the parent would stop looking like the owner of what follows.
 */
function SectionLegend({ depth, children }: { depth: number; children: React.ReactNode }) {
  if (depth === 0) {
    return <FieldLegend variant="legend">{children}</FieldLegend>;
  }
  return (
    <FieldLegend variant="label" className={depth === 1 ? undefined : "text-muted-foreground"}>
      {children}
    </FieldLegend>
  );
}

/** The copy a section carries under its title, and nothing else. */
function SectionDescription({ node }: { node: EditorNode }) {
  const description = getNodeProperty(node, "description");
  if (typeof description !== "string" || description.length === 0) {
    return null;
  }
  return <FieldDescription>{description}</FieldDescription>;
}

/** A text property's value, as the string a shell prop takes. */
function textOf(value: EditablePropertyValue): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** A container's display text: its title, or its code, or its id. */
function labelFor(node: EditorNode): string {
  // One rule, in the drag layer, because a name said two ways in two files is
  // a name a screen reader reads two ways: the same node can be read out by a
  // keyboard drag and drawn as a header.
  return nodeName(node);
}

/**
 * Whether a boundary needs a rule drawn across it.
 *
 * Two sections next to each other need one, or their titles read as a single
 * stack of headings. A field after a title does not: the title already owns
 * everything under it.
 */
function needsSectionBreak(child: EditorNode, index: number): boolean {
  return index > 0 && !isMaterializableFieldType(child.type);
}

/** The `options` list a leaf carries, which only a `choice` ever has. */
function optionsOf(value: EditablePropertyValue): readonly FieldOption[] {
  return Array.isArray(value) ? (value as readonly FieldOption[]) : [];
}

/**
 * One leaf, drawn as it will be drawn.
 *
 * The control is bound read-only and unanswered: the editor is not a submission,
 * so typing into a field has nowhere to go. What the leaf shows is the document
 * — its type, its constraints through the control, its label and description
 * through the shell — so a mistake in the inspector is visible here.
 */
function LeafPreview({ node }: { node: EditorNode }) {
  // A container has no control: `defineControl` throws for it, and the
  // generated renderer returns `null` for a type it does not cover. The
  // container branch below is the one that draws it.
  if (!isMaterializableFieldType(node.type)) {
    return null;
  }
  const description = getNodeProperty(node, "description");
  const options = optionsOf(getNodeProperty(node, "options"));
  const required = getNodeProperty(node, "required") === true;
  return (
    <>
      {renderColanderField(
        controls,
        {
          type: node.type,
          id: domId(node.id),
          code: node.code,
          field: node.field,
          options,
          // The same rule the runtime binds by: an unanswered field carries the
          // value the core's table implies for its type, never `undefined`, and
          // for a choice the value its own `allowMultiple` implies — `null` for a
          // single-select, `[]` for a multiple.
          value: unansweredValueFor(node.type, node.field.allowMultiple),
          // A draft is not an answer. The control reports a change nobody wants
          // in this slice, and swallowing it is the honest response: the route
          // does not fetch or save, so an answer here would be stored nowhere.
          onChange: () => {},
          disabled: false,
          readOnly: true,
          required,
          label: labelFor(node),
          description: textOf(description) || undefined,
          errors: [],
        },
        // The shell gets the runtime's own shell props, spread. The label, the
        // required mark and the messages were already decided above this call by
        // the same function that decides them for a form being answered, and
        // re-deriving them here would be the one place the editor could draw a
        // field differently from the form it is building.
        (shellProps, child) => (
          <controls.shell {...shellProps}>{child}</controls.shell>
        ),
      )}
    </>
  );
}

/**
 * The explicit controls for one node: add a child, remove, move up, move down.
 *
 * Reordering is two moves and not only a drag, because a drag that the model
 * refuses is a drag that has to be undone by hand, and because a drag is not
 * reachable from a keyboard. The index for a move inside one parent is the
 * target index, and the model measures it after the removal, so moving down
 * from index 2 is index 3; the button is disabled at the ends of the list,
 * where a move has nowhere to go.
 *
 * The drag handle below is an *addition* to this row, not a replacement for
 * any of it: same variant, same size, same place in the group, and the arrows
 * stay exactly as they are whether a drag exists or not. The handle is also
 * reachable from a keyboard -- it is a button, and Enter/Space lift a node,
 * the arrows aim it and Escape puts it back -- so a drag is a first-class
 * interaction here rather than a mouse-only extra. Everything all three routes
 * can do ends at the same two calls, `moveNode` and `removeNode`, so the ways of
 * working cannot drift apart in what they do -- only in how they are reached.
 */
function NodeControls({
  model,
  node,
  onAddTarget,
  onEdit,
  drag,
  onDragStart,
  onAim,
  onDragEnd,
  onDrop,
  onAnnounce,
}: {
  model: DocumentModel;
  node: EditorNode;
  onAddTarget: (parentId: string | null) => void;
  onEdit: RunEdit;
  drag: EditorDrag | null;
  onDragStart: (id: string) => void;
  onAim: (target: EditorDropTarget | null) => void;
  onDragEnd: () => void;
  onDrop: (target: EditorDropTarget) => void;
  onAnnounce: (message: string) => void;
}) {
  const siblings = node.parent === null ? model.root : node.parent.children;
  const index = siblings.indexOf(node);
  const first = index <= 0;
  const last = index < 0 || index >= siblings.length - 1;
  const parentId = node.parent === null ? null : node.parent.id;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <DragHandle
        model={model}
        node={node}
        label={labelFor(node)}
        drag={drag}
        onDragStart={onDragStart}
        onAim={onAim}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
        onAnnounce={onAnnounce}
      />
      {isContainerFieldType(node.type) ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            onAddTarget(node.id);
          }}
        >
          <PlusIcon aria-hidden="true" />
          Add child
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={first}
        aria-label={`Move ${labelFor(node)} up`}
        onClick={() => {
          onEdit(() => {
            moveNode(model, node.id, parentId, index - 1);
          });
        }}
      >
        <ArrowUpIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={last}
        aria-label={`Move ${labelFor(node)} down`}
        onClick={() => {
          onEdit(() => {
            moveNode(model, node.id, parentId, index + 1);
          });
        }}
      >
        <ArrowDownIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-destructive"
        onClick={() => {
          onEdit(() => {
            removeNode(model, node.id);
          });
        }}
      >
        <Trash2Icon aria-hidden="true" />
        Remove
      </Button>
    </div>
  );
}

/** The refusal the model gave about this node, drawn under it. */
function NodeRefusal({ node, refusal }: { node: EditorNode; refusal: EditorRefusal | null }) {
  if (refusal === null || refusal.fieldId !== node.id) {
    return null;
  }
  return (
    <p className="text-xs text-destructive" role="alert">
      {refusal.message}
    </p>
  );
}

/**
 * The node's own header: what it is, where it is selected, and the controls.
 *
 * The header is chrome the runtime does not have, so it is kept to one quiet
 * line: whatever the caller needs to say about the node, the code in a
 * monospace face, and the buttons. The selected node is marked with a border
 * and `aria-current`, because that is the only difference between "you are
 * editing this" and "you are looking at it" in a tree of look-alike sections.
 */
function NodeHeader({
  model,
  node,
  selected,
  onSelect,
  onAddTarget,
  onEdit,
  drag,
  onAnnounce,
  children,
}: {
  model: DocumentModel;
  node: EditorNode;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onAddTarget: (parentId: string | null) => void;
  onEdit: RunEdit;
  drag: DragWiring;
  onAnnounce: (message: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-transparent px-1 py-1",
        selected ? "border-border bg-muted/40" : "hover:border-border/60",
      )}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => {
          onSelect(selected ? null : node.id);
        }}
        className="flex min-w-0 items-center gap-2 text-left"
      >
        {children}
        <span className="truncate font-mono text-xs text-muted-foreground">
          {node.code.length > 0 ? node.code : node.id}
        </span>
      </button>
      <div className="ml-auto">
        <NodeControls
          model={model}
          node={node}
          onAddTarget={onAddTarget}
          onEdit={onEdit}
          drag={drag.drag}
          onDragStart={drag.onDragStart}
          onAim={drag.onDragOver}
          onDragEnd={drag.onDragEnd}
          onDrop={drag.onDrop}
          onAnnounce={onAnnounce}
        />
      </div>
    </div>
  );
}

/**
 * A repeater's own copy: the bounds its rows run between.
 *
 * `minItems` and `maxItems` reach no control — they belong to the repeater, and
 * a control cannot re-derive them. They are read here only to be shown, because
 * a repeater whose bounds are set somewhere invisible looks unbounded.
 */
function RepeaterBounds({ node }: { node: EditorNode }) {
  const min = getNodeProperty(node, "minItems");
  const max = getNodeProperty(node, "maxItems");
  if (typeof min !== "number" && typeof max !== "number") {
    return null;
  }
  return (
    <Badge variant="outline">
      rows {typeof min === "number" ? min : 0}
      {typeof max === "number" ? `–${max}` : " and up"}
    </Badge>
  );
}

/** Which component a `component-ref` names, shown as the node's own fact. */
function ComponentTarget({ node }: { node: EditorNode }) {
  if (node.type !== "component-ref") {
    return null;
  }
  const code = getComponentRefProperty(node, "componentCode");
  const version = getComponentRefProperty(node, "componentVersion");
  const named = typeof code === "string" && code.length > 0;
  const versioned = named && typeof version === "string" && version.length > 0;
  return (
    <Badge variant={named ? "outline" : "destructive"}>
      {named ? `component ${code}${versioned ? `@${version}` : ""}` : "names no component"}
    </Badge>
  );
}

/**
 * The drag props as one bundle.
 *
 * Every node hands all five to the handle in its header, so they travel
 * together rather than as five more entries in three signatures. The route owns
 * them and the tree only forwards them: no node keeps a drag of its own, which
 * is what keeps a node from disagreeing with the route about what is being
 * carried. The zone around a node needs only `drag` -- the zone itself reports
 * nothing, it just says which node it is, and the route's one monitor reads
 * every zone at once.
 */
type DragWiring = Pick<
  EditorTreeProps,
  "drag" | "onDragStart" | "onDragOver" | "onDragEnd" | "onDrop"
>;

/** One node, of whichever of the two kinds it is. */
function TreeNode({
  model,
  node,
  depth,
  selectedId,
  onSelect,
  onAddTarget,
  onEdit,
  drag,
  refusal,
  onAnnounce,
}: {
  model: DocumentModel;
  node: EditorNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddTarget: (parentId: string | null) => void;
  onEdit: RunEdit;
  drag: DragWiring;
  refusal: EditorRefusal | null;
  onAnnounce: (message: string) => void;
}) {
  const selected = selectedId === node.id;

  if (!isContainerFieldType(node.type)) {
    // The header above a leaf is chrome only: the type and the code. The title
    // is not repeated here, because the shell below draws the label exactly as
    // it will at runtime and a second copy of the same words above it is the
    // one place the editor could look like a different product.
    return (
      <DropZone node={node} drag={drag.drag}>
        <div className="flex flex-col gap-1">
          <NodeHeader
            model={model}
            node={node}
            selected={selected}
            onSelect={onSelect}
            onAddTarget={onAddTarget}
            onEdit={onEdit}
            drag={drag}
            onAnnounce={onAnnounce}
          >
            <Badge variant="outline">{node.type}</Badge>
          </NodeHeader>
          <div className="px-1">
            <LeafPreview node={node} />
          </div>
          <NodeRefusal node={node} refusal={refusal} />
        </div>
      </DropZone>
    );
  }

  // A repeater's children are the template of one row, not rows of their own.
  // The document holds the fields; the rows are answers, and this slice edits
  // the document, so the template is drawn once and labelled as such.
  const isRepeater = node.type === "repeater";
  return (
    <DropZone node={node} drag={drag.drag}>
      <FieldSet className="gap-2">
        {/* The legend leads the fieldset, so it is its first child: a fieldset's
            name is its first legend, and a section that announces itself after a
            row of buttons is a section with no name. */}
        <div className="flex flex-wrap items-center gap-2">
          <SectionLegend depth={depth}>{labelFor(node)}</SectionLegend>
          <Badge variant="secondary">{node.type}</Badge>
        </div>
        <SectionDescription node={node} />
        <NodeHeader
          model={model}
          node={node}
          selected={selected}
          onSelect={onSelect}
          onAddTarget={onAddTarget}
          onEdit={onEdit}
          drag={drag}
          onAnnounce={onAnnounce}
        >
          <RepeaterBounds node={node} />
          <ComponentTarget node={node} />
          <span className="text-xs text-muted-foreground">
            {isRepeater ? "row template below" : "fields below"}
          </span>
        </NodeHeader>
        <NodeRefusal node={node} refusal={refusal} />
        <FieldGroup>
          {node.children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing inside yet. &ldquo;Add child&rdquo; puts the first field in this {node.type}.
            </p>
          ) : (
            node.children.map((child, childIndex) => (
              <div key={child.id} className="flex flex-col gap-3">
                {needsSectionBreak(child, childIndex) ? <FieldSeparator /> : null}
                <TreeNode
                  model={model}
                  node={child}
                  depth={depth + 1}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onAddTarget={onAddTarget}
                  onEdit={onEdit}
                  drag={drag}
                  refusal={refusal}
                  onAnnounce={onAnnounce}
                />
              </div>
            ))
          )}
        </FieldGroup>
      </FieldSet>
    </DropZone>
  );
}

/**
 * The whole document, as a tree.
 *
 * The root is a `FieldGroup` and not a fieldset: a form is a list of sections,
 * and a box around the list would claim the form is one section of something
 * larger. A refusal the model attributed to no field at all is drawn under the
 * root, because it happened to the document rather than to a node.
 *
 * Drag and drop is wired in here and nowhere else. The tree holds no drag state
 * of its own: it is given the drag the route is holding and reports back where
 * the pointer is pointing, or where a keyboard drag has walked to, so a node
 * cannot believe it is being carried when the route does not. Nothing is moved
 * here either — a drop leaves this file as a position and comes back as a
 * changed model, or as a refusal drawn in the same place every other refusal is
 * drawn. The two words a keyboard drag speaks are read out from here, by a
 * live region nobody can see, so a lift, an aim and a release are announced
 * where the rest of this file is drawn.
 */
export function EditorTree({
  model,
  selectedId,
  onSelect,
  onAddTarget,
  drag,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  announcement,
  onAnnounce,
  onEdit,
  refusal,
}: EditorTreeProps) {
  const wiring: DragWiring = { drag, onDragStart, onDragOver, onDragEnd, onDrop };
  return (
    <FieldGroup>
      {model.root.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This form has no fields yet. Add one from the palette: the document is created empty and
          its field list is built by the model on the first add.
        </p>
      ) : (
        model.root.map((node, index) => (
          <div key={node.id} className="flex flex-col gap-3">
            {needsSectionBreak(node, index) ? <FieldSeparator /> : null}
            <TreeNode
              model={model}
              node={node}
              depth={0}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddTarget={onAddTarget}
              onEdit={onEdit}
              drag={wiring}
              refusal={refusal}
              onAnnounce={onAnnounce}
            />
          </div>
        ))
      )}
      {refusal !== null && refusal.fieldId === null ? (
        <p className="text-xs text-destructive" role="alert">
          {refusal.message}
        </p>
      ) : null}
      <DragAnnouncer message={announcement} />
    </FieldGroup>
  );
}
