import type { CoreInfo } from "@ailura/colander-client";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ServerIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SampleExecution } from "@/samples";

export type BackendState = "checking" | "online" | "offline";

interface BackendStatusProps {
  state: BackendState;
  execution: SampleExecution;
  core: CoreInfo | null;
  contentHash: string | null;
  detail: string | null;
  onRetry: () => void;
}

function StateIcon({ state }: { state: BackendState }) {
  if (state === "online") {
    return <CircleCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />;
  }
  if (state === "offline") {
    return <CircleAlertIcon className="size-4 text-destructive" />;
  }
  return <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />;
}

const STATE_COPY: Record<BackendState, Record<SampleExecution, string>> = {
  checking: {
    http: "Checking HTTP core…",
    wasm: "Loading packed WASM…",
  },
  online: {
    http: "HTTP core reachable",
    wasm: "Packed WASM ready",
  },
  offline: {
    http: "Nest backend unreachable",
    wasm: "WASM asset unavailable",
  },
};

/** The selected source's identity, availability, and compiled content hash. */
export function BackendStatus({
  state,
  execution,
  core,
  contentHash,
  detail,
  onRetry,
}: BackendStatusProps) {
  const sourceLabel = execution === "wasm" ? "Packed WASM" : "HTTP /api";

  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <ServerIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Colander source</span>
          <Badge variant="outline">{sourceLabel}</Badge>
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <StateIcon state={state} />
            {STATE_COPY[state][execution]}
          </span>
        </div>

        {core !== null && state !== "offline" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{core.versionInfo.name}</Badge>
            <Badge variant="outline">v{core.versionInfo.version}</Badge>
            <Badge variant="outline">ABI {core.versionInfo.abi}</Badge>
          </div>
        ) : null}

        {contentHash !== null ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">Content hash</span>
            <code className="truncate font-mono text-xs text-foreground" title={contentHash}>
              {contentHash}
            </code>
          </div>
        ) : null}

        {state === "offline" || detail !== null ? (
          <div className="ml-auto flex items-center gap-2">
            {detail !== null ? (
              <span
                className={cn(
                  "max-w-[46ch] truncate text-xs",
                  state === "offline" ? "text-destructive" : "text-muted-foreground",
                )}
                title={detail}
              >
                {detail}
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCwIcon aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
