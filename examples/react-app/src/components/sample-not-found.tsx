import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SAMPLES } from "@/samples";

/**
 * The router-wide not-found boundary. It states that the requested id is
 * unknown and lists the samples that do exist, so a mistyped URL is a dead end
 * with a way out rather than a silently substituted sample.
 */
export default function SampleNotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>The requested sample does not exist</CardTitle>
          <CardDescription>
            The id in the address is not one of the {SAMPLES.length} samples this example defines.
            Open one of them below.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {SAMPLES.map((entry) => (
            <Button
              key={entry.id}
              asChild
              variant="outline"
              className="h-auto w-full items-start justify-between gap-3 py-2 text-left"
            >
              <Link to="/samples/$sampleId" params={{ sampleId: entry.id }}>
                <span className="flex min-w-0 flex-col items-start gap-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{entry.name}</span>
                    <Badge variant="secondary">{entry.id}</Badge>
                  </span>
                  <span className="text-xs font-normal text-balance text-muted-foreground">
                    {entry.summary}
                  </span>
                </span>
              </Link>
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
