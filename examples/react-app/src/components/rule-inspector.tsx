import { humanizeCode, type FormDefinition, type RuleEvaluation } from "@ailura/colander-client";
import { LoaderCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface RuleInspectorProps {
  evaluation: RuleEvaluation | null;
  definition: FormDefinition | null;
  evaluating: boolean;
  error: string | null;
}

function TriState({ value }: { value: boolean | undefined }) {
  if (value === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return value ? (
    <Badge
      variant="outline"
      className="border-emerald-600/30 text-emerald-700 dark:text-emerald-400"
    >
      yes
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      no
    </Badge>
  );
}

function formatValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * A live read of the evaluation returned by the selected Colander source.
 * Nothing here is computed in the browser: the table is the response body,
 * resolved to field labels through the compiled form definition's id/code index.
 */
export function RuleInspector({ evaluation, definition, evaluating, error }: RuleInspectorProps) {
  const ids =
    evaluation === null
      ? []
      : Array.from(
          new Set([
            ...Object.keys(evaluation.visibility),
            ...Object.keys(evaluation.enabled),
            ...Object.keys(evaluation.required),
          ]),
        );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Rule evaluation
          {evaluating ? (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              evaluating
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          Returned by the selected Colander rule-evaluation source, keyed by field id (booleans) and
          field code (calculated values).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}

        {evaluation === null ? (
          <p className="text-sm text-muted-foreground">
            {evaluating
              ? "Waiting for the selected source…"
              : "No evaluation yet. Edit a value to ask the selected source."}
          </p>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Visible</th>
                    <th className="px-3 py-2 font-medium">Read-only</th>
                    <th className="px-3 py-2 font-medium">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {ids.map((id) => {
                    const code = definition?.codeById[id] ?? "";
                    const label =
                      definition?.labelById[id] ?? (code.length > 0 ? humanizeCode(code) : id);
                    const staticReadOnly =
                      definition?.staticReadOnlyById[id] === true ||
                      (code.length > 0 && definition?.calculatedCodes.has(code) === true);
                    const readOnly =
                      evaluation.enabled[id] === undefined
                        ? staticReadOnly
                          ? true
                          : undefined
                        : staticReadOnly || !evaluation.enabled[id];
                    return (
                      <tr key={id} className="border-t border-border/60 align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium">{label}</div>
                          <div className="font-mono text-xs break-words text-muted-foreground">
                            {code !== "" ? `${id} · ${code}` : id}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <TriState value={evaluation.visibility[id]} />
                        </td>
                        <td className="px-3 py-2">
                          <TriState value={readOnly} />
                        </td>
                        <td className="px-3 py-2">
                          <TriState value={evaluation.required[id]} />
                        </td>
                      </tr>
                    );
                  })}
                  {ids.length === 0 ? (
                    <tr className="border-t border-border/60">
                      <td colSpan={4} className="px-3 py-3 text-sm text-muted-foreground">
                        The engine returned no visibility, enabled or required entries.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Calculated values (by code)
              </span>
              {Object.keys(evaluation.calculatedValues).length === 0 ? (
                <p className="text-sm text-muted-foreground">None for the current values.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {Object.entries(evaluation.calculatedValues).map(([code, value]) => (
                    <li
                      key={code}
                      className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-1.5"
                    >
                      <span className="font-mono text-xs">{code}</span>
                      <span className="font-mono text-sm font-medium">{formatValue(value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {evaluation.validationErrors.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Rule validation errors
                </span>
                <ul className="flex flex-col gap-1">
                  {evaluation.validationErrors.map((ruleError) => (
                    <li
                      key={`${ruleError.code}-${ruleError.message}`}
                      className={cn(
                        "rounded-md bg-destructive/10 px-3 py-1.5 text-sm text-destructive",
                      )}
                    >
                      <span className="font-mono text-xs">{ruleError.code}</span>{" "}
                      {ruleError.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Separator />
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                Raw response body
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                {JSON.stringify(evaluation, null, 2)}
              </pre>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
