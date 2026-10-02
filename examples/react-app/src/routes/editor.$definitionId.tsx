import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";

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
  type EditorDocuments,
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
import {
  hasUnsavedChanges,
  type DefinitionDocuments,
  type LiveSchemaCheck,
  type VersionDetail,
  type VersionSummary,
} from "@/lib/definitions-api";
import {
  httpDefinitionsApi,
  toDefinitionsApiError,
  type DefinitionsApiError,
} from "@/lib/http-definitions-api";

export const Route = createFileRoute("/editor/$definitionId")({
  component: DefinitionEditorRoute,
});

/**
 * The page as a whole: the definition's versions and the one on screen.
 *
 * `detail` is the version read, documents and `schemaCheck` included, exactly as
 * the resource returned it. `baseline` is the document as stored, expressed
 * through the model's one serialisation: it is what the dirty state is compared
 * against, and it is why loading a version nobody has touched leaves the page
 * clean. It is a *value*, taken when the version was read or when a save was
 * stored, never a flag anybody has to remember to clear.
 */
type EditorState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "empty" }
  | {
      readonly kind: "loaded";
      readonly versions: readonly VersionSummary[];
      readonly detail: VersionDetail;
      readonly baseline: DefinitionDocuments;
    };

/** What an action on a version is doing right now, if anything. */
type Pending = { readonly label: string } | null;

/** The two failures a person can act on, and the rest, kept apart by kind. */
interface ActionFailures {
  readonly save: string | null;
  readonly publish: string | null;
  readonly conflict: DefinitionsApiError | null;
}

const NO_FAILURES: ActionFailures = { save: null, publish: null, conflict: null };

/**
 * The version a definition opens on: the newest draft, because a draft is what
 * can be edited, and the newest published version when there is no draft — a
 * real state, a form that has been published and whose next version has not
 * been started, not an error.
 */
function versionToOpen(versions: readonly VersionSummary[]): VersionSummary | null {
  const newest = [...versions].sort((a, b) => b.version - a.version);
  return newest.find((version) => version.status === "draft") ?? newest[0] ?? null;
}

/**
 * The editor, wired to the stored resource.
 *
 * The shape of the editing surface is the one `/editor/new` already has — the
 * same model, tree, palette, inspector, drag monitor and refusal channel — with
 * a load in front of it and a save, a publish and a clone behind it. What this
 * route adds is persistence, and it adds it in the two ways the model requires:
 * the documents enter the model as the text the database stored, and the text
 * that leaves it is whatever the model's one `serialiseDocuments` produced. It
 * also adds no validation of its own: the core's verdict about the stored text
 * arrives in the version read and is rendered as it arrived.
 */
function DefinitionEditorRoute() {
  const { definitionId } = Route.useParams();
  const [state, setState] = useState<EditorState>({ kind: "loading" });
  const [pending, setPending] = useState<Pending>(null);
  const [failures, setFailures] = useState<ActionFailures>(NO_FAILURES);

  /**
   * The load: the version list, then the chosen version.
   *
   * Two reads, in that order, because a summary says nothing about a version's
   * documents. The four strings go into the model's `parseDocuments` as they
   * arrived — never parsed and re-serialised on the way in — and the same
   * response's `schemaCheck` is the core's verdict about those same bytes.
   */
  const loadVersion = useCallback(
    (target: string, list: readonly VersionSummary[]) => {
      setState({ kind: "loading" });
      setFailures(NO_FAILURES);
      setPending(null);

      void (async () => {
        let detail: VersionDetail;
        try {
          detail = await httpDefinitionsApi.getVersion(definitionId, target);
        } catch (error) {
          setState({ kind: "error", message: toDefinitionsApiError(error).message });
          return;
        }

        let baseline: EditorDocuments;
        try {
          // The baseline is the model projecting the stored document. Reading it
          // through the same serialisation a save would send is what makes an
          // untouched load clean: the comparison is between two of the model's
          // own texts, never between the editor and a remembered flag.
          baseline = serialiseDocuments(parseDocuments(storedDocuments(detail)));
        } catch (error) {
          // The stored text is not a document this model can hold. That is a
          // real state, and it is reported in the model's own words rather than
          // as a refusal of something the author did.
          setState({
            kind: "error",
            message:
              error instanceof EditorModelError ? `${error.code}: ${error.message}` : String(error),
          });
          return;
        }

        setState({ kind: "loaded", versions: list, detail, baseline });
      })();
    },
    [definitionId],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let list: readonly VersionSummary[];
      try {
        list = await httpDefinitionsApi.getVersions(definitionId);
      } catch (error) {
        if (!cancelled) {
          setState({ kind: "error", message: toDefinitionsApiError(error).message });
        }
        return;
      }
      if (cancelled) {
        return;
      }
      const first = versionToOpen(list);
      if (first === null) {
        setState({ kind: "empty" });
        return;
      }
      loadVersion(first.id, list);
    })();

    return () => {
      cancelled = true;
    };
  }, [definitionId, loadVersion]);

  /**
   * The save.
   *
   * A draft save is never gated by the core, because a draft may be invalid: a
   * save the core dislikes is a save that happened, followed by the verdict it
   * reports. So the answer is a re-read of the version, whose `schemaCheck` is
   * the core's judgement on the text that was just stored — the live validation
   * for this editor, before and after a save alike.
   *
   * A conflict is the other outcome, and it is a state the author can act on: the
   * version is published and frozen, and a published form only ever changes by
   * being cloned. So the conflict names its code and offers the clone.
   */
  const save = (versionId: string, documents: DefinitionDocuments) => {
    setPending({ label: "Saving…" });
    setFailures(NO_FAILURES);

    void (async () => {
      try {
        await httpDefinitionsApi.updateDraft(definitionId, versionId, documents);
      } catch (error) {
        const failure = toDefinitionsApiError(error);
        setFailures(
          failure.kind === "conflict"
            ? { ...NO_FAILURES, conflict: failure }
            : { ...NO_FAILURES, save: failure.message },
        );
        setPending(null);
        return;
      }

      let detail: VersionDetail;
      try {
        detail = await httpDefinitionsApi.getVersion(definitionId, versionId);
      } catch (error) {
        setFailures({ ...NO_FAILURES, save: toDefinitionsApiError(error).message });
        setPending(null);
        return;
      }
      setState((current) =>
        current.kind === "loaded"
          ? {
              kind: "loaded",
              versions: replaceVersion(current.versions, detail),
              // The text that was sent is what is stored, so it is what the
              // dirty state is compared against from now on. The document on
              // screen has not moved.
              baseline: documents,
              detail,
            }
          : current,
      );
      setPending(null);
    })();
  };

  /**
   * The publish: the core rules, the server publishes, the trigger freezes the
   * row. The core's own refusal is shown as it arrived, not paraphrased, and the
   * version read afterwards is the frozen one, so the page stops offering an edit
   * that could only fail.
   */
  const publish = (versionId: string) => {
    setPending({ label: "Publishing…" });
    setFailures(NO_FAILURES);

    void (async () => {
      try {
        await httpDefinitionsApi.publishVersion(definitionId, versionId);
      } catch (error) {
        // The message is the core's, kept verbatim. This page has no second
        // opinion to offer, and a paraphrase would be a second answer.
        setFailures({ ...NO_FAILURES, publish: toDefinitionsApiError(error).message });
        setPending(null);
        return;
      }
      setState((current) =>
        current.kind === "loaded"
          ? {
              kind: "loaded",
              versions: replaceVersion(current.versions, {
                ...current.detail,
                status: "published",
              }),
              detail: { ...current.detail, status: "published" },
              baseline: current.baseline,
            }
          : current,
      );
      setPending(null);
    })();
  };

  /**
   * The clone, which is what a conflict on a published version leads to. The
   * source version is untouched; the copy is a new draft and the editor opens
   * it, so the work continues where the frozen document cannot.
   */
  const clone = (versionId: string) => {
    setPending({ label: "Cloning…" });
    setFailures(NO_FAILURES);

    void (async () => {
      let created: VersionSummary;
      try {
        created = await httpDefinitionsApi.cloneVersion(definitionId, versionId);
      } catch (error) {
        setFailures({ ...NO_FAILURES, save: toDefinitionsApiError(error).message });
        setPending(null);
        return;
      }
      let list: readonly VersionSummary[] = [];
      try {
        list = await httpDefinitionsApi.getVersions(definitionId);
      } catch {
        // A stale version list is a convenience, not the work: failing to
        // refresh it must not cost the author the clone that did happen.
        list = [created];
      }
      setPending(null);
      loadVersion(created.id, list);
    })();
  };

  if (state.kind === "loading") {
    return (
      <EditorShell pending={null} busy={false}>
        <LoadingCard />
      </EditorShell>
    );
  }
  if (state.kind === "error") {
    return (
      <EditorShell pending={null} busy={false}>
        <Alert variant="destructive">
          <AlertTitle>This definition could not be loaded</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      </EditorShell>
    );
  }
  if (state.kind === "empty") {
    return (
      <EditorShell pending={null} busy={false}>
        <EmptyCard definitionId={definitionId} />
      </EditorShell>
    );
  }

  return (
    <EditorShell pending={pending} busy={pending !== null}>
      <EditorPage
        key={state.detail.id}
        definitionId={definitionId}
        versions={state.versions}
        detail={state.detail}
        baseline={state.baseline}
        failures={failures}
        busy={pending !== null}
        onSelectVersion={(versionId) => {
          loadVersion(versionId, state.versions);
        }}
        onSave={save}
        onPublish={publish}
        onClone={clone}
      />
    </EditorShell>
  );
}

/** The four documents of a version read, exactly as they were stored. */
function storedDocuments(detail: VersionDetail): DefinitionDocuments {
  return {
    formSchemaJson: detail.formSchemaJson,
    uiSchemaJson: detail.uiSchemaJson,
    rulesSchemaJson: detail.rulesSchemaJson,
    componentsJson: detail.componentsJson,
  };
}

function replaceVersion(
  versions: readonly VersionSummary[],
  detail: VersionSummary,
): readonly VersionSummary[] {
  const replaced = versions.some((version) => version.id === detail.id);
  const next = replaced
    ? versions.map((version) => (version.id === detail.id ? detail : version))
    : [...versions, detail];
  return [...next].sort((a, b) => b.version - a.version);
}

/**
 * The page around whatever it is showing: the header, with the back path to the
 * list and whatever the current action is doing.
 */
function EditorShell({
  pending,
  busy,
  children,
}: {
  pending: Pending;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-sm font-semibold">colander form editor</h1>
            <p className="text-xs text-muted-foreground">
              A stored definition, read as text and saved through the model&rsquo;s one
              serialisation.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {pending === null ? null : (
              <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
                {pending.label}
              </span>
            )}
            <Button asChild variant="outline" size="sm" disabled={busy}>
              <Link to="/definitions">All forms</Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

/**
 * The editing surface, once a version is on screen.
 *
 * Split out and keyed by version id so the model — which is mutated in place,
 * and which React cannot see change — belongs to exactly one version at a time.
 * Saving re-reads the version without changing that key, so the document under
 * the author is the same object before and after a save.
 */
function EditorPage({
  definitionId,
  versions,
  detail,
  baseline,
  failures,
  busy,
  onSelectVersion,
  onSave,
  onPublish,
  onClone,
}: {
  definitionId: string;
  versions: readonly VersionSummary[];
  detail: VersionDetail;
  baseline: DefinitionDocuments;
  failures: ActionFailures;
  busy: boolean;
  onSelectVersion: (versionId: string) => void;
  onSave: (versionId: string, documents: DefinitionDocuments) => void;
  onPublish: (versionId: string) => void;
  onClone: (versionId: string) => void;
}) {
  // The model is parsed once, from the text the resource stored, and edited in
  // place. What triggers the redraw is the counter below, because the mutation
  // is invisible to React by construction.
  const [model] = useState<DocumentModel>(() => parseDocuments(storedDocuments(detail)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteTargetId, setPaletteTargetId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<EditorRefusal | null>(null);
  const [drag, setDrag] = useState<EditorDrag | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [, redraw] = useState(0);

  // Read fresh on every render, so the text on this page can never lag behind an
  // edit it did not observe, and so the dirty state below is a comparison
  // against what is stored rather than a flag.
  const documents = serialiseDocuments(model);
  const dirty = hasUnsavedChanges(documents, baseline);
  const isPublished = detail.status === "published";

  /**
   * Leaving with unsaved work is a question, not a silent discard: the guard is
   * armed only while the document on screen differs from the stored one, and it
   * is disarmed by the same comparison the badge above is drawn from.
   */
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Still consulted by the browsers that read `returnValue`.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
    };
  }, [dirty]);

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
      // The refusal is said as well as drawn: the alert is how a sighted author
      // reads it, the live region is how a keyboard author does.
      setAnnouncement(`Refused: ${error.message}`);
    } finally {
      // A node that was just removed cannot still be an add target, and leaving
      // it set would make the next add fail on a target nobody chose.
      setPaletteTargetId((current) =>
        current !== null && nodeById(model, current) === null ? null : current,
      );
      redraw((count) => count + 1);
    }
    return accepted;
  };

  /**
   * The move a drop is asking for. The drag is closed first whatever the model
   * says, and the move goes through `runEdit` like every other edit, so a refused
   * drop is refused in the same words in the same places as a refused arrow key.
   * Nothing is moved optimistically: the model is the only writer of the
   * document, so a refused drop leaves the tree exactly as it was.
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

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isPublished ? "default" : "secondary"}>
          v{detail.version} {detail.status}
        </Badge>
        <Badge variant={dirty ? "destructive" : "outline"}>
          {dirty ? "Unsaved changes" : "Saved"}
        </Badge>
        {isPublished ? (
          <span className="text-xs text-muted-foreground">
            A published version is frozen. Clone it into a new draft to keep changing the form.
          </span>
        ) : null}
      </div>

      <VersionBar
        versions={versions}
        selectedId={detail.id}
        blocked={dirty}
        blockedReason="This draft has unsaved work, so opening another version is held back rather than throwing it away."
        onSelect={onSelectVersion}
      />

      {failures.conflict === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>This version is published and cannot be changed</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive" className="font-mono">
              {failures.conflict.code}
            </Badge>
            <span>
              {failures.conflict.message} A published form only ever changes by being cloned into a
              new draft, and this version stays frozen either way.
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onClone(detail.id)}>
              Clone into a new draft
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {failures.save === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>The save did not happen</AlertTitle>
          <AlertDescription>{failures.save}</AlertDescription>
        </Alert>
      )}

      {failures.publish === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>The core refused this publication</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap font-mono text-xs">{failures.publish}</p>
          </AlertDescription>
        </Alert>
      )}

      <SchemaCheckPanel schemaCheck={detail.schemaCheck} contentHash={detail.contentHash} />

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

      <div className="flex flex-wrap items-center gap-2">
        {isPublished ? null : (
          <>
            <Button
              size="sm"
              disabled={busy || !dirty}
              onClick={() => onSave(detail.id, documents)}
            >
              Save draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || dirty}
              onClick={() => onPublish(detail.id)}
              title={
                dirty
                  ? "Publication freezes the stored text, and what is on screen is not stored yet."
                  : undefined
              }
            >
              Publish this version
            </Button>
            {dirty ? (
              <span className="text-xs text-muted-foreground">
                Publishing is offered once the draft on screen is the stored one.
              </span>
            ) : null}
          </>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onClone(detail.id)}>
          Clone into a new draft
        </Button>
        {isPublished ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/forms/$formId" params={{ formId: definitionId }}>
              Open the running form
            </Link>
          </Button>
        ) : null}
      </div>

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
                A leaf draws through the same control the form will use at runtime, so a field looks
                here exactly as it will look answered. Containers own their children; a
                repeater&rsquo;s children are the template of one row.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EditorTree
                model={model}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAddTarget={setPaletteTargetId}
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
                The exact text a save sends, produced by the model&rsquo;s one serialisation and by
                nothing else in the editor.
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
    </>
  );
}

/** The versions of this definition, newest first, and the one on screen. */
function VersionBar({
  versions,
  selectedId,
  blocked,
  blockedReason,
  onSelect,
}: {
  versions: readonly VersionSummary[];
  selectedId: string;
  blocked: boolean;
  blockedReason: string;
  onSelect: (versionId: string) => void;
}) {
  const ordered = [...versions].sort((a, b) => b.version - a.version);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Versions</CardTitle>
        <CardDescription>
          A published version is frozen; every change to this form happens on a draft. Opening
          another version while this one is unsaved is held back, so no work is discarded without a
          decision.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {ordered.map((version) => (
          <Button
            key={version.id}
            size="sm"
            variant={version.id === selectedId ? "default" : "outline"}
            disabled={blocked && version.id !== selectedId}
            title={blocked ? blockedReason : undefined}
            onClick={() => onSelect(version.id)}
          >
            v{version.version} · {version.status}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * The core's verdict, shown as it arrived.
 *
 * This is the editor's live validation and it belongs to the core, not to the
 * browser: the `valid: false` branch carries the core's own code and message,
 * and this page adds no second opinion of its own. Before a save it describes
 * the text that is stored; after one, the text that was just stored.
 */
function SchemaCheckPanel({
  schemaCheck,
  contentHash,
}: {
  schemaCheck: LiveSchemaCheck;
  contentHash: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Core validation</CardTitle>
          {schemaCheck.valid ? <Badge>Valid</Badge> : <Badge variant="destructive">Invalid</Badge>}
        </div>
        <CardDescription>
          The core&rsquo;s own verdict on the stored document text, computed by the resource and
          forwarded unchanged. This is not a client-side guess.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {schemaCheck.valid ? (
          <p className="text-muted-foreground">
            The stored text compiles.
            {schemaCheck.contentHash === undefined ? null : (
              <>
                {" "}
                It would publish as <span className="font-mono">{schemaCheck.contentHash}</span>.
              </>
            )}
          </p>
        ) : (
          <>
            {schemaCheck.code === undefined ? null : (
              <Badge variant="destructive" className="w-fit font-mono">
                {schemaCheck.code}
              </Badge>
            )}
            <p className="whitespace-pre-wrap text-destructive">{schemaCheck.message}</p>
            <p className="text-xs text-muted-foreground">
              A draft is allowed to be invalid, so this is what it says rather than a reason the
              save was refused: the save is stored either way.
            </p>
          </>
        )}
        {contentHash === null ? null : (
          <p className="text-xs text-muted-foreground">
            Stored content hash: <span className="font-mono">{contentHash}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Loading the version…</CardTitle>
        <CardDescription>
          The version list, then the chosen version. The documents are read as text and go into the
          model exactly as they were stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-8 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

/** A definition with no versions at all. A real state, with the way out. */
function EmptyCard({ definitionId }: { definitionId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>This definition has no versions</CardTitle>
        <CardDescription>
          The definition <span className="font-mono">{definitionId}</span> exists, but no version of
          it does, so there is no document to edit. Create a new form, or come back once a version
          exists.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/definitions">All forms</Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/editor/new">Start a new form</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
