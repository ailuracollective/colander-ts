import {
  createFormDefinitionFromCompiled,
  type CompiledForm,
  type DescribedForm,
  type ResponseValidation,
  type ValidationMode,
} from "@ailura/colander-client";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { FormRunner } from "@/components/form-runner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createColanderApi, toColanderSourceError } from "@/lib/api";
import { createPublishedCompileRequest, type PublishedForm } from "@/lib/definitions-api";
import { httpColanderTransport } from "@/lib/http-colander-transport";
import { httpDefinitionsApi, toDefinitionsApiError } from "@/lib/http-definitions-api";

export const Route = createFileRoute("/forms/$formId")({
  component: DefinitionRoute,
});

/**
 * Why the page is showing what it is showing.
 *
 * `no_published` is a state, not a failure: the definition exists, the backend
 * is reachable, and nothing has been published yet. It has its own branch so it
 * can never be answered with a sample, and never with an empty form rendered as
 * if it were the stored one.
 */
type PageState =
  | { readonly kind: "loading" }
  | { readonly kind: "no_published" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly published: PublishedForm;
      readonly compiled: CompiledForm;
      readonly described: DescribedForm;
    };

/**
 * The compile and the description go through the same source-neutral API the
 * samples use, over the HTTP transport.
 *
 * A stored definition is not a sample, so there is no per-entry `execution`
 * choice to read the way `App.tsx` reads one off its sample. The samples'
 * default is the HTTP source — and these documents came from the backend in the
 * first place — so HTTP is the default here too. Swapping this for
 * `wasmColanderTransport` is a one-line change; the core call is identical
 * either way.
 */
const TRANSPORT = httpColanderTransport;

/** The label this page shows for the source it is using. */
const TRANSPORT_LABEL = "HTTP /api";

/**
 * `App.tsx` starts in Complete and no sample starts in Draft, so this page does
 * the same. A published stored form is a real submission rather than a sketch,
 * and Complete is the mode a reviewer expects to see first.
 */
const DEFAULT_MODE: ValidationMode = "Complete";

/** A stored published form carries no prefilled answers, unlike the samples. */
const NO_INITIAL_VALUES: Record<string, unknown> = {};

function DefinitionRoute() {
  const { formId } = Route.useParams();
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const [mode, setMode] = useState<ValidationMode>(DEFAULT_MODE);
  const [validation, setValidation] = useState<ResponseValidation | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const api = useMemo(() => createColanderApi(TRANSPORT), []);

  useEffect(() => {
    let cancelled = false;
    setPage({ kind: "loading" });
    setRunError(null);

    void (async () => {
      let published: PublishedForm;
      try {
        published = await httpDefinitionsApi.getPublished(formId);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const failure = toDefinitionsApiError(error);
        setPage(
          failure.kind === "no_published_version"
            ? { kind: "no_published" }
            : { kind: "error", message: failure.message },
        );
        return;
      }

      // The documents enter the compile request as the strings the API
      // returned. Nothing on this path parses or re-serializes a document: a
      // re-serialization rewrites number literals and can reorder keys, so the
      // core would compute a different content hash than the one stored.
      const request = createPublishedCompileRequest(published);
      try {
        // The description is of the *compiled* form, so both calls take the
        // same request, exactly as the samples do.
        const compiled = await api.compile(request);
        const described = await api.describeForm(request);
        if (cancelled) {
          return;
        }
        setPage({ kind: "ready", published, compiled, described });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPage({ kind: "error", message: toColanderSourceError(error).message });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `api` is memoized, so the form id is the only thing that re-runs this.
  }, [api, formId]);

  const definition = useMemo(() => {
    if (page.kind !== "ready") {
      return null;
    }
    return createFormDefinitionFromCompiled(page.compiled, page.described);
  }, [page]);

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-sm font-semibold">colander form runner</h1>
            <p className="text-xs text-muted-foreground">
              A stored definition, read as text and compiled by the selected source.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {TRANSPORT_LABEL}
            </span>
            <Button asChild variant="outline" size="sm">
              <Link to="/editor/$definitionId" params={{ definitionId: formId }}>
                Open in the editor
              </Link>
            </Button>
            <Tabs value={mode} onValueChange={(value) => setMode(value as ValidationMode)}>
              <TabsList aria-label="Validation mode">
                <TabsTrigger value="Draft">Draft</TabsTrigger>
                <TabsTrigger value="Complete">Complete</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
        {page.kind === "loading" ? <LoadingCard /> : null}
        {page.kind === "no_published" ? <NothingPublishedCard formId={formId} /> : null}
        {page.kind === "error" ? <LoadFailedCard message={page.message} /> : null}
        {page.kind === "ready" && definition !== null ? (
          <FormRunner
            key={`http:${page.compiled.contentHash}`}
            compiled={page.compiled}
            definition={definition}
            initialValues={NO_INITIAL_VALUES}
            mode={mode}
            transport={TRANSPORT}
            validation={validation}
            onEvaluation={() => {
              setRunError(null);
            }}
            onValidation={(next) => {
              setValidation(next);
            }}
            onError={(next) => {
              setRunError(next);
            }}
            onEvaluating={(next) => {
              setBusy(next ? "Evaluating rules…" : null);
            }}
            onValidating={(next) => {
              setBusy(next ? "Validating the response…" : null);
            }}
          />
        ) : null}
        {page.kind === "ready" ? (
          <p className="text-xs text-muted-foreground">
            Published version {page.published.version} · stored document hash{" "}
            {page.published.contentHash} · compiled as {page.compiled.contentHash}
          </p>
        ) : null}
        {busy !== null ? (
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {busy}
          </p>
        ) : null}
        {runError !== null ? (
          <p className="text-xs text-destructive" role="status" aria-live="polite">
            {runError}
          </p>
        ) : null}
      </main>
    </div>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Loading the published form…</CardTitle>
        <CardDescription>
          The documents are read as text and handed to the core exactly as they were stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-8 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

/**
 * Nothing published is a real state of a real form, and it is stated as one. No
 * sample is substituted and no empty form is rendered: either would show a form
 * the database does not hold.
 */
function NothingPublishedCard({ formId }: { formId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>This form has nothing published yet</CardTitle>
        <CardDescription>
          The definition <span className="font-mono">{formId}</span> exists, but no version of it is
          published, so there is no form to render. Publish a version and this page shows it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/editor/$definitionId" params={{ definitionId: formId }}>
            Open it in the editor
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/definitions">All forms</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/">Back to the samples</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function LoadFailedCard({ message }: { message: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>The published form could not be loaded</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/definitions">All forms</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
