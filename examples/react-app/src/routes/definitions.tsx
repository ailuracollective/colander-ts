import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DefinitionSummary } from "@/lib/definitions-api";
import { httpDefinitionsApi, toDefinitionsApiError } from "@/lib/http-definitions-api";

export const Route = createFileRoute("/definitions")({
  component: DefinitionsRoute,
});

/**
 * Why the list is showing what it is showing.
 *
 * An empty list is a state this product has, not a failure: nothing has been
 * created yet, which is exactly what the call to `/editor/new` is for. It gets
 * its own branch so it can never be answered with an error card.
 */
type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly definitions: readonly DefinitionSummary[] };

/**
 * Every stored definition, with the two facts that decide what a person can do
 * with it: how many versions it has, and whether one of them is published.
 *
 * A definition with nothing published has an editor link and no runtime link,
 * because `/forms/:id` would answer `no_published_version` and the page would
 * spend the reader's time explaining a state the list already knew. A published
 * one has both, and neither is a guess: the link to the editor points at the
 * draft route, and a published version is copied by clone rather than edited in
 * place.
 */
function DefinitionsRoute() {
  const [state, setState] = useState<ListState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    void (async () => {
      try {
        const definitions = await httpDefinitionsApi.listDefinitions();
        if (cancelled) {
          return;
        }
        setState(definitions.length === 0 ? { kind: "empty" } : { kind: "ready", definitions });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({ kind: "error", message: toDefinitionsApiError(error).message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-sm font-semibold">colander forms</h1>
            <p className="text-xs text-muted-foreground">
              Every stored definition, its versions, and whether it is published.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm">
              <Link to="/editor/new">New form</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/">Back to the samples</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        {state.kind === "loading" ? <LoadingCard /> : null}
        {state.kind === "empty" ? <EmptyCard /> : null}
        {state.kind === "error" ? <ErrorCard message={state.message} /> : null}
        {state.kind === "ready" ? (
          <ul className="flex flex-col gap-3">
            {state.definitions.map((definition) => (
              <li key={definition.id}>
                <DefinitionCard definition={definition} />
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </div>
  );
}

function DefinitionCard({ definition }: { definition: DefinitionSummary }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{definition.name}</CardTitle>
          {definition.isPublished ? (
            <Badge>Published</Badge>
          ) : (
            <Badge variant="secondary">Draft only</Badge>
          )}
          <Badge variant="outline">
            {definition.versionCount} {definition.versionCount === 1 ? "version" : "versions"}
          </Badge>
        </div>
        <CardDescription>
          {definition.description === "" ? (
            <span className="text-muted-foreground">No description.</span>
          ) : (
            definition.description
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/editor/$definitionId" params={{ definitionId: definition.id }}>
            Open in the editor
          </Link>
        </Button>
        {definition.isPublished ? (
          <Button asChild variant="outline" size="sm">
            <Link to="/forms/$formId" params={{ formId: definition.id }}>
              Open the running form
            </Link>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Nothing published yet, so there is no running form to open. Publish a version from the
            editor.
          </span>
        )}
        <span className="font-mono text-xs text-muted-foreground">{definition.id}</span>
      </CardContent>
    </Card>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Loading the definitions…</CardTitle>
        <CardDescription>
          The list carries what the resource stored: a version count and whether a version is
          published.
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
 * No definitions is the state right after the first visit, and it is answered
 * with the way out rather than with an apology or an empty table.
 */
function EmptyCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No forms are stored yet</CardTitle>
        <CardDescription>
          Nothing has been created, so there is nothing to list. Start a blank document, or fetch
          nothing and come back once a definition exists.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link to="/editor/new">Build the first form</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/">Back to the samples</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>The definitions could not be loaded</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
