import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EditorModelError,
  fieldIds,
  isContainerFieldType,
  moveNode,
  nodeById,
  parseDocuments,
  serialiseDocuments,
  type DocumentModel,
} from "@/editor";
import {
  documentOrder,
  dropOutcomeMessage,
  useDragMonitor,
  type EditorDrag,
  type EditorDropTarget,
} from "@/editor/drag-and-drop";
import { EditorTree, type EditorRefusal, type RunEdit } from "@/editor/editor-tree";
import { EditorInspector } from "@/editor/inspector";
import { EditorPalette } from "@/editor/palette";

export const Route = createFileRoute("/editor/new")({
  component: NewFormRoute,
});

/**
 * The empty form this page starts from.
 *
 * This is the one piece of document text the page supplies, and it is text
 * rather than an object for the model's own reason: `parseDocuments` is the only
 * door into the model, and it reads text. The page does not assemble a field,
 * a container, or a `fields` array — the model treats a form document with no
 * field list as an empty form and creates the list itself on the first add, so
 * the empty document and the first field are both the model's work.
 */
const EMPTY_FORM_TEXT = "{}";

/**
 * `/editor/new` is the first slice of the editor: a blank form, edited in
 * memory.
 *
 * It fetches nothing and stores nothing, and it says so in the header rather
 * than in a footnote, because a form that looks saved and is not is the worst
 * state this page can be in. Loading a stored form and persisting one are the
 * next piece, and until then the text below the tree is the exact bytes a save
 * would store — produced by the model's one serialisation, and stored nowhere.
 *
 * Refusals are this page's error channel. The model refuses with a code rather
 * than throwing a string, every edit goes through {@link runEdit}, and what it
 * refused is drawn in the header and next to the node it was about. A draft can
 * be invalid, and a refusal is how this page says so instead of swallowing it.
 *
 * A drag is a fourth piece of state on this page, beside `selectedId` and the
 * palette target, and it is held here for the same reason those are: it is
 * interaction, not document. This page also owns the one drag monitor, because
 * the library's ledger is registered once and this is where the drag lives. The
 * tree is told which node is in the air and where it points, and a drop comes
 * back as a position that goes through {@link runEdit} like every other edit —
 * so a move the model refuses is refused in the same words, in the same place,
 * as a move the arrows refused. Nothing is moved optimistically: the only
 * writer of the document is the model, and a refused drop leaves the tree
 * exactly as it was.
 *
 * A pointer drag and a keyboard drag arrive at the same place. The handle lifts
 * a node on a pointer or on Enter, aims it with the pointer's bands or with the
 * arrow keys, and drops it either way, so this page cannot tell them apart and
 * therefore cannot treat one of them as the real one.
 */
function NewFormRoute() {
  // The model is held once and edited in place: its nodes write into the parsed
  // documents, so a new model per render would throw the edits away. What
  // triggers the redraw is the counter below, because the mutation is invisible
  // to React by construction.
  const [model] = useState<DocumentModel>(() =>
    parseDocuments({ formSchemaJson: EMPTY_FORM_TEXT }),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteTargetId, setPaletteTargetId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<EditorRefusal | null>(null);
  const [drag, setDrag] = useState<EditorDrag | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [, redraw] = useState(0);

  const runEdit: RunEdit = (action) => {
    let accepted = true;
    try {
      action();
      setRefusal(null);
    } catch (error) {
      if (!(error instanceof EditorModelError)) {
        throw error;
      }
      accepted = false;
      setRefusal({ code: error.code, message: error.message, fieldId: error.fieldId });
      // The refusal is said as well as drawn. The alert beside the node is how a
      // sighted author reads it; the live region is how a keyboard author does,
      // and a keyboard author is the one who cannot see the alert arrive.
      setAnnouncement(`Refused: ${error.message}`);
    } finally {
      // The model mutates in place, so the redraw is the only signal React gets
      // that the document changed. The palette's target is checked here as
      // well: a node that was just removed cannot still be an add target, and
      // leaving it set would make the next add fail on a target the author
      // never chose.
      setPaletteTargetId((current) =>
        current !== null && nodeById(model, current) === null ? null : current,
      );
      redraw((count) => count + 1);
    }
    return accepted;
  };

  /**
   * Attempt the move a drop is asking for.
   *
   * The drag is closed first, whatever the model says: the pointer has let go,
   * and a drag still "in the air" after a refusal would draw an indicator over
   * a node that did not move. Then the move is handed to `runEdit` like every
   * other edit, so the model's refusal arrives through the same channel as the
   * arrows' and is drawn in the same two places. The tree is not touched on the
   * way there, which is what makes a refused drop leave the document as it was
   * rather than as it looked halfway.
   *
   * The `carried === null` line is a type guard and not a decision. A drop is
   * only dispatched while a drag is in the air, so reaching this with no drag
   * is not a case the product can produce, and it is **not** a refusal worth
   * showing: there is no move here to refuse, and the only way to render one
   * would be to invent an `EditorModelErrorCode` in the route, which is this
   * editor's one forbidden move -- the interaction layer deciding what the
   * model would say. The rule this page keeps is narrower and it is kept: a
   * move the model refuses is never swallowed. A drop that was never a move
   * attempt is not that.
   *
   * And it is the route, not the handle, that says what the drop did. The
   * document's order is read before and after, so the sentence is a report:
   * either it names the move, or it says the node did not move and where it
   * already was. That is the answer to a release that does nothing, which
   * used to be silence — the model accepts a no-op, so nothing refused, so
   * nothing was said. A refusal short-circuits the report, because
   * `runEdit` has already announced the model's own sentence.
   */
  const dropOn = (target: EditorDropTarget) => {
    const carried = drag;
    setDrag(null);
    if (carried === null) {
      return;
    }
    const before = documentOrder(model);
    const accepted = runEdit(() => {
      moveNode(model, carried.nodeId, target.parentId, target.index);
    });
    if (accepted) {
      setAnnouncement(dropOutcomeMessage(model, carried.nodeId, target, before));
    }
  };

  /**
   * The one monitor for the whole editor.
   *
   * The library's ledger is a singleton by design: registering a second one
   * would deliver every event twice. It is registered here, next to the drag
   * state it reports into, and it is the only place a pointer drag becomes a
   * position. A release over nothing is a cancel rather than a drop, because
   * there is no move to attempt and nothing for the model to refuse.
   */
  useDragMonitor({
    model,
    onStart: (id) => {
      setDrag({ nodeId: id, target: null });
    },
    onAim: (target) => {
      setDrag((current) => (current === null ? null : { ...current, target }));
    },
    onCancel: () => {
      setDrag(null);
    },
    onDrop: dropOn,
  });

  const selected = selectedId === null ? null : nodeById(model, selectedId);
  const ids = fieldIds(model);
  const containers = ids.filter((id) => {
    const node = nodeById(model, id);
    return node !== null && isContainerFieldType(node.type);
  }).length;
  // Shown, never stored: the model's one serialisation, read fresh on every
  // render so the panel can never lag behind an edit it did not observe.
  const documents = serialiseDocuments(model);

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-sm font-semibold">colander form editor</h1>
            <p className="text-xs text-muted-foreground">
              A blank form, built through the document model. Fields, containers and every property
              they declare.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Badge variant="destructive">Not saved</Badge>
            <Button asChild variant="outline" size="sm">
              <Link to="/definitions">All forms</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/">Back to the samples</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">
        <Alert variant="default">
          <AlertTitle>This draft is in memory only</AlertTitle>
          <AlertDescription>
            Nothing here is fetched and nothing here is stored: a reload loses this form, and the
            document text below is what a save would send, not what is saved. To work on a form that
            is stored, open it from{" "}
            <Link to="/definitions" className="underline">
              the list of forms
            </Link>
            . A draft can be invalid, so this page shows the model&rsquo;s refusals rather than
            pretending the form is ready to answer.
          </AlertDescription>
        </Alert>

        {refusal === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>The model refused the last edit</AlertTitle>
            <AlertDescription>
              <Badge variant="destructive" className="mr-2 font-mono">
                {refusal.code}
              </Badge>
              {refusal.message}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Form structure</CardTitle>
                  <Badge variant="outline">
                    {ids.length} {ids.length === 1 ? "field" : "fields"} · {containers} container
                    {containers === 1 ? "" : "s"}
                  </Badge>
                </div>
                <CardDescription>
                  A leaf draws through the same control the form will use at runtime, so a field
                  looks here exactly as it will look answered. Containers own their children; a
                  repeater&rsquo;s children are the template of one row.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EditorTree
                  model={model}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelectedId(id);
                  }}
                  onAddTarget={(parentId) => {
                    setPaletteTargetId(parentId);
                  }}
                  drag={drag}
                  onDragStart={(id) => {
                    setDrag({ nodeId: id, target: null });
                  }}
                  onDragOver={(target) => {
                    setDrag((current) => (current === null ? null : { ...current, target }));
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                  }}
                  onDrop={dropOn}
                  announcement={announcement}
                  onAnnounce={setAnnouncement}
                  onEdit={runEdit}
                  refusal={refusal}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Document text</CardTitle>
                <CardDescription>
                  The exact text a save would store, produced by the model&rsquo;s one serialisation
                  and by nothing else in the editor. It is shown, not saved.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                  {documents.formSchemaJson}
                </pre>
                <p className="text-xs text-muted-foreground">
                  ui document: {documents.uiSchemaJson === null ? "none" : "present"} · rules
                  document: {documents.rulesSchemaJson === null ? "none" : "present"} · components:
                  forwarded untouched ({documents.componentsJson === null ? "none" : "present"})
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <EditorPalette
              model={model}
              targetId={paletteTargetId}
              onEdit={runEdit}
              onClose={() => {
                setPaletteTargetId(null);
              }}
            />
            <EditorInspector model={model} node={selected} onEdit={runEdit} />
          </div>
        </div>
      </main>
    </div>
  );
}
