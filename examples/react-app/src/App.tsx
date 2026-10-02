import {
  createFormDefinitionFromCompiled,
  type CompiledForm,
  type CoreInfo,
  type DescribedForm,
  type ResponseValidation,
  type RuleEvaluation,
  type ValidationMode,
} from "@ailura/colander-client";
import { useNavigate } from "@tanstack/react-router";
import { BracesIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BackendStatus, type BackendState } from "@/components/backend-status";
import { FormRunner } from "@/components/form-runner";
import { RuleInspector } from "@/components/rule-inspector";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ValidationPanel } from "@/components/validation-panel";
import { createColanderApi, toColanderSourceError } from "@/lib/api";
import { httpColanderTransport } from "@/lib/http-colander-transport";
import {
  applyTheme,
  getThemeMediaQuery,
  getThemeRoot,
  getThemeStorage,
  parseThemePreference,
  persistThemePreference,
  readThemePreference,
  subscribeToSystemTheme,
  THEME_OPTIONS,
  type ThemePreference,
} from "@/lib/theme";
import { wasmColanderTransport } from "@/lib/wasm-colander-transport";
import { SAMPLES, createSampleCompileRequest, findSample, type SampleExecution } from "@/samples";

const THEME_PERSISTENCE_ERROR =
  "Theme preference could not be saved. It will apply for this session.";

export default function App({ sampleId }: { sampleId: string }) {
  const navigate = useNavigate();
  const [sourceState, setSourceState] = useState<BackendState>("checking");
  const [core, setCore] = useState<CoreInfo | null>(null);
  const [sourceDetail, setSourceDetail] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const [mode, setMode] = useState<ValidationMode>("Complete");
  const [themePreference, setThemePreference] = useState<ThemePreference | null>(null);
  const [themePersistenceError, setThemePersistenceError] = useState<string | null>(null);

  const [compiled, setCompiled] = useState<CompiledForm | null>(null);
  const [described, setDescribed] = useState<DescribedForm | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);

  const [evaluation, setEvaluation] = useState<RuleEvaluation | null>(null);
  const [validation, setValidation] = useState<ResponseValidation | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    const root = getThemeRoot();
    const mediaQuery = getThemeMediaQuery();
    const activeTheme = themePreference ?? readThemePreference(getThemeStorage());

    setThemePreference(activeTheme);
    applyTheme(root, activeTheme, mediaQuery);

    if (activeTheme !== "system") {
      return;
    }
    return subscribeToSystemTheme(mediaQuery, () => {
      applyTheme(getThemeRoot(), "system", mediaQuery);
    });
  }, [themePreference]);

  const updateTheme = (value: string) => {
    const nextTheme = parseThemePreference(value);
    setThemePreference(nextTheme);
    applyTheme(getThemeRoot(), nextTheme, getThemeMediaQuery());
    const saved = persistThemePreference(nextTheme, getThemeStorage());
    setThemePersistenceError(saved ? null : THEME_PERSISTENCE_ERROR);
  };

  const sample = useMemo(() => findSample(sampleId), [sampleId]);
  const selectedTransport = useMemo(
    () => (sample.execution === "wasm" ? wasmColanderTransport : httpColanderTransport),
    [sample.execution],
  );
  const api = useMemo(() => createColanderApi(selectedTransport), [selectedTransport]);

  const definition = useMemo(() => {
    if (compiled === null || described === null) {
      return null;
    }
    return createFormDefinitionFromCompiled(compiled, described);
  }, [compiled, described]);

  // Identity of the selected core, and the honest unavailable signal.
  useEffect(() => {
    let cancelled = false;
    setSourceState("checking");
    setCore(null);
    setSourceDetail(null);
    api
      .getCore()
      .then((info) => {
        if (cancelled) {
          return;
        }
        setCore(info);
        setSourceState("online");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setSourceState("offline");
        setSourceDetail(toColanderSourceError(error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, retryToken]);

  // Compile the selected sample through its explicitly selected source.
  useEffect(() => {
    let cancelled = false;

    setCompiling(true);
    setCompileError(null);
    setCompiled(null);
    setDescribed(null);
    setEvaluation(null);
    setValidation(null);
    setRunError(null);
    setEvaluating(false);
    setValidating(false);

    const request = createSampleCompileRequest(sample);
    // The description and the compilation come from the core together: the
    // description is of the *compiled* form, so a `component-ref` is reported by
    // its expansion and the hash covers exactly what is rendered.
    api
      .compile(request)
      .then((compiledForm) => api.describeForm(request).then((form) => ({ compiledForm, form })))
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCompiled(result.compiledForm);
        setDescribed(result.form);
        setSourceState("online");
        setSourceDetail(null);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const sourceError = toColanderSourceError(error);
        setCompileError(sourceError.message);
        if (sourceError.kind === "network" || sourceError.kind === "unavailable") {
          setSourceState("offline");
          setSourceDetail(sourceError.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCompiling(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, sample, retryToken]);

  const retry = () => setRetryToken((token) => token + 1);

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <BracesIcon className="size-4 text-muted-foreground" />
            <div>
              <h1 className="text-sm font-semibold">colander form runner</h1>
              <p className="text-xs text-muted-foreground">
                Native React controls render the form; Colander decides.
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {sample.execution === "wasm" ? "WASM" : "HTTP /api"}
            </span>
            <Select
              value={sampleId}
              onValueChange={(next) => {
                // The selected sample is the address, so the choice survives a
                // reload and a mistyped id can be reported as not found.
                void navigate({ to: "/samples/$sampleId", params: { sampleId: next } });
              }}
            >
              <SelectTrigger className="w-[220px]" size="sm">
                <SelectValue placeholder="Select a sample" />
              </SelectTrigger>
              <SelectContent>
                {SAMPLES.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2">
                <label
                  id="color-theme-label"
                  htmlFor="color-theme"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Color theme
                </label>
                <Select value={themePreference ?? undefined} onValueChange={updateTheme}>
                  <SelectTrigger
                    id="color-theme"
                    aria-labelledby="color-theme-label"
                    className="w-28"
                    size="sm"
                  >
                    <SelectValue placeholder="Loading theme…" />
                  </SelectTrigger>
                  <SelectContent>
                    {THEME_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {themePersistenceError !== null ? (
                <p
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="max-w-64 text-xs text-muted-foreground"
                >
                  {themePersistenceError}
                </p>
              ) : null}
            </div>

            <Tabs value={mode} onValueChange={(value) => setMode(value as ValidationMode)}>
              <TabsList aria-label="Validation mode">
                <TabsTrigger value="Draft">Draft</TabsTrigger>
                <TabsTrigger value="Complete">Complete</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 pb-3 sm:px-6">
          <BackendStatus
            state={sourceState}
            execution={sample.execution}
            core={core}
            contentHash={compiled?.contentHash ?? null}
            detail={sourceDetail}
            onRetry={retry}
          />
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          {runError !== null ? (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>Colander request failed</AlertTitle>
              <AlertDescription>{runError}</AlertDescription>
            </Alert>
          ) : null}

          {compiling ? (
            <LoadingCard execution={sample.execution} />
          ) : sourceState === "offline" && compiled === null ? (
            <OfflineCard execution={sample.execution} detail={sourceDetail} onRetry={retry} />
          ) : compileError !== null ? (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>The form could not be compiled</AlertTitle>
              <AlertDescription>{compileError}</AlertDescription>
            </Alert>
          ) : compiled !== null && definition !== null ? (
            <>
              <FormRunner
                key={`${sample.execution}:${compiled.contentHash}`}
                compiled={compiled}
                definition={definition}
                initialValues={sample.initialValues}
                mode={mode}
                transport={selectedTransport}
                validation={validation}
                onEvaluation={setEvaluation}
                onValidation={setValidation}
                onError={setRunError}
                onEvaluating={setEvaluating}
                onValidating={setValidating}
              />
              <p className="text-xs text-muted-foreground">{sample.expected}</p>
            </>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <RuleInspector
            evaluation={evaluation}
            definition={definition}
            evaluating={evaluating}
            error={null}
          />
          <ValidationPanel
            validation={validation}
            definition={definition}
            mode={mode}
            validating={validating}
            error={null}
          />
        </aside>
      </main>
    </div>
  );
}

function LoadingCard({ execution }: { execution: SampleExecution }) {
  const description =
    execution === "wasm"
      ? "The packed WebAssembly binding is expanding the document and fixing its content hash. The browser may fetch the same-origin WASM asset."
      : "The HTTP transport is expanding the document and fixing its content hash.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compiling the form…</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-8 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
        <div className="h-8 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

function OfflineCard({
  execution,
  detail,
  onRetry,
}: {
  execution: SampleExecution;
  detail: string | null;
  onRetry: () => void;
}) {
  const isWasm = execution === "wasm";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isWasm ? "WASM core unavailable" : "Backend unreachable"}</CardTitle>
        <CardDescription>
          {isWasm
            ? "The browser could not load the same-origin packaged Colander WebAssembly asset. No NestJS backend is required for this sample."
            : "The NestJS example is not answering at the /api proxy. Nothing is faked here — start the backend and retry."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <pre className="rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {isWasm
            ? "wasm/colander.wasm · packaged @ailura/colander asset"
            : "pnpm --dir examples/nest-app start"}
        </pre>
        {detail !== null ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
        >
          Retry
        </button>
      </CardContent>
    </Card>
  );
}
