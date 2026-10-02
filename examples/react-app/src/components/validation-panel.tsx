import {
  resolveFieldForPath,
  type FormDefinition,
  type ResponseValidation,
  type ValidationMode,
} from "@ailura/colander-client";
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface ValidationPanelProps {
  validation: ResponseValidation | null;
  definition: FormDefinition | null;
  mode: ValidationMode;
  validating: boolean;
  error: string | null;
}

/**
 * The validation verdict. Each `ResponseError.path` is resolved back to the
 * field it belongs to and shown by label; the raw pointer stays as secondary
 * text so the mapping is still auditable.
 */
export function ValidationPanel({
  validation,
  definition,
  mode,
  validating,
  error,
}: ValidationPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Validation
          <Badge variant="outline">{mode}</Badge>
          {validating ? (
            <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
        </CardTitle>
        <CardDescription>From the selected Colander response-validation source.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}

        {validation === null ? (
          <p className="text-sm text-muted-foreground">
            {validating
              ? "Validating…"
              : "No validation yet. Press Validate to submit the current answers."}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {validation.isValid ? (
                <>
                  <CircleCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-medium">Valid</span>
                </>
              ) : (
                <>
                  <CircleAlertIcon className="size-4 text-destructive" />
                  <span className="text-sm font-medium text-destructive">
                    {validation.errors.length} error
                    {validation.errors.length === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </div>

            {validation.errors.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {validation.errors.map((responseError) => {
                  const resolved =
                    definition === null
                      ? null
                      : resolveFieldForPath(definition, responseError.path);
                  return (
                    <li
                      key={`${responseError.code}-${responseError.path}-${responseError.message}`}
                      className="rounded-lg bg-destructive/10 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {resolved?.label ?? "Unmapped path"}
                        </span>
                        <Badge variant="destructive">{responseError.code}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-destructive">{responseError.message}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {responseError.path}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <Separator />
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                Normalized answers returned by the selected source
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                {validation.normalizedAnswersJson}
              </pre>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
