import {
  applyEvaluation,
  createEvaluateRulesRequest,
  createRuleState,
  createValidateResponseRequest,
  resolveFieldForPath,
  type ColanderTransport,
  type CompiledForm,
  type FormDefinition,
  type FormNode,
  type LeafNode,
  type ResponseValidation,
  type RuleEvaluation,
  type RuleState,
  type ValidationMode,
} from "@ailura/colander-client";
import { renderColanderField } from "@ailura/colander-compiler/runtime";
import { unansweredValueFor } from "@ailura/colander-compiler/utilities";
import { useForm, useSelector, type AnyFormApi } from "@tanstack/react-form";
import { LoaderCircleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as controls from "@/components/colander";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { toColanderSourceError } from "@/lib/api";
import { runEvaluationThenValidation } from "@/lib/form-submission";

interface FormRunnerProps {
  compiled: CompiledForm;
  definition: FormDefinition;
  initialValues: Record<string, unknown>;
  mode: ValidationMode;
  transport: ColanderTransport;
  validation: ResponseValidation | null;
  onEvaluation: (evaluation: RuleEvaluation) => void;
  onValidation: (validation: ResponseValidation) => void;
  onError: (message: string | null) => void;
  onEvaluating: (evaluating: boolean) => void;
  onValidating: (validating: boolean) => void;
}

export interface FormValues {
  /** Field codes stay as literal keys inside this one answers object. */
  answers: Record<string, unknown>;
}

type RuleUiState = Omit<RuleState, "values">;

function toRuleUiState(state: RuleState): RuleUiState {
  return {
    visibility: state.visibility,
    enabled: state.enabled,
    required: state.required,
    readOnly: state.readOnly,
  };
}

interface ValueScope {
  get: (code: string) => unknown;
  set: (code: string, value: unknown) => void;
  update: (code: string, updater: (current: unknown) => unknown) => void;
}

interface NodeRendererProps {
  node: FormNode;
  state: RuleUiState;
  scope: ValueScope;
  errors: Record<string, string[]>;
  hiddenById: Record<string, boolean>;
  idPrefix: string;
  /**
   * How many groups enclose this node.
   *
   * Depth is the only thing that changes a section's appearance, and it changes
   * one thing: a top-level section leads the card and a nested one is a label
   * inside its parent. The frame itself is the same at every level, because a
   * section is a group of fields and not a box around them.
   */
  depth?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function domId(prefix: string, key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${prefix}-${safeKey}`;
}

function errorText(errors: Record<string, string[]>, code: string): string[] {
  return errors[code] ?? [];
}

/**
 * A section title.
 *
 * Three levels exist in these documents and each one steps down: a top-level
 * group leads the card, a component or group inside it is a section, and a group
 * inside that is a sub-section and reads as secondary. Without the third step a
 * parent title and its first child are the same words at the same size, and the
 * parent stops looking like the owner of what follows it.
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
function SectionDescription({ description }: { description?: string }) {
  return description === undefined ? null : <FieldDescription>{description}</FieldDescription>;
}

/** The messages the core reported against a section rather than against a field. */
function SectionErrors({ id, errors }: { id: string; errors: string[] }) {
  return <FieldError id={id} errors={errors.map((message) => ({ message }))} />;
}

/**
 * Whether a boundary needs a rule drawn across it.
 *
 * Two sections sitting next to each other need one, or their titles read as a
 * single stack of headings. A field following a title does not: the title already
 * owns everything under it, and a rule there would cut the field away from the
 * question it answers.
 */
function needsSectionBreak(child: FormNode, index: number): boolean {
  return index > 0 && child.kind !== "field";
}

/**
 * Bind one field of the core's model to the generated control for its type.
 *
 * There is no branch on `node.type` here, and that is the whole point: which
 * control a type becomes, and which properties that control receives, were both
 * decided by the core's table and this application's mapping before this file ran.
 * The generated tree does the dispatching, so this file neither looks a component
 * up by type nor narrows the answer.
 */
function GeneratedControl({
  node,
  state,
  scope,
  errors,
  idPrefix,
}: {
  node: LeafNode;
  state: RuleUiState;
  scope: ValueScope;
  errors: Record<string, string[]>;
  idPrefix: string;
}) {
  const ruleId = node.id || node.code;
  return (
    <>
      {renderColanderField(
        controls,
        {
          type: node.type,
          id: domId(idPrefix, ruleId),
          code: node.code,
          field: node.field,
          options: node.options,
          // The contract gives every type a value kind and none of them is
          // "absent". A field nobody has answered arrives as `undefined`, and for
          // a choice that is not survivable: the control reads the answer, so
          // `undefined` has no branch and takes the page down. The unanswered
          // value is the one the core's own table implies for the type, and for a
          // choice it is the one its `allowMultiple` implies — `null` for a
          // single-select, `[]` for a multiple — which is why the field's own
          // property is passed rather than the type alone.
          value: scope.get(node.code) ?? unansweredValueFor(node.type, node.field.allowMultiple),
          onChange: (value) => scope.set(node.code, value),
          disabled: state.enabled[ruleId] === false,
          readOnly: state.readOnly[ruleId] === true,
          required: state.required[ruleId] === true,
          label: node.label,
          description: node.description,
          errors: errorText(errors, node.code),
        },
        (shellProps, child) => (
          <controls.shell
            id={String(shellProps["id"])}
            label={String(shellProps["label"])}
            required={shellProps["required"] === true}
            description={
              typeof shellProps["description"] === "string" ? shellProps["description"] : undefined
            }
            errors={(shellProps["errors"] as readonly string[]) ?? []}
          >
            {child}
          </controls.shell>
        ),
      )}
    </>
  );
}

function RepeaterControl({
  node,
  state,
  scope,
  errors,
  hiddenById,
  idPrefix,
  depth = 0,
}: {
  node: Extract<FormNode, { kind: "repeater" }>;
  state: RuleUiState;
  scope: ValueScope;
  errors: Record<string, string[]>;
  hiddenById: Record<string, boolean>;
  idPrefix: string;
  depth?: number;
}) {
  const ruleId = node.id || node.code;
  const value = scope.get(node.code);
  const rows = Array.isArray(value) ? value : [];
  const enabled = state.enabled[ruleId] !== false;
  const readOnly = state.readOnly[ruleId] === true;
  const required = state.required[ruleId] === true;
  const messages = errorText(errors, node.code);
  const headingId = domId(idPrefix, ruleId);
  const minItems =
    typeof node.field.minItems === "number" && node.field.minItems > 0 ? node.field.minItems : 0;
  const maxItems =
    typeof node.field.maxItems === "number" && node.field.maxItems > 0
      ? node.field.maxItems
      : undefined;

  const updateRows = (updater: (currentRows: unknown[]) => unknown[]): void => {
    scope.update(node.code, (value) => updater(Array.isArray(value) ? value : []));
  };

  return (
    <FieldSet
      id={headingId}
      aria-describedby={messages.length > 0 ? `${headingId}-error` : undefined}
      aria-required={required}
      aria-disabled={!enabled || readOnly || undefined}
    >
      <SectionLegend depth={depth}>{node.label}</SectionLegend>
      <SectionDescription description={node.description} />
      {required ? <Badge variant="outline">Required</Badge> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rows yet. Add one to answer this question.
        </p>
      ) : (
        rows.map((_row, rowIndex) => {
          const rowScope: ValueScope = {
            get: (childCode) => {
              const currentRows = scope.get(node.code);
              const currentRow = Array.isArray(currentRows) ? currentRows[rowIndex] : undefined;
              return isRecord(currentRow) ? currentRow[childCode] : undefined;
            },
            set: (childCode, childValue) => {
              updateRows((currentRows) =>
                currentRows.map((current, index) =>
                  index === rowIndex
                    ? {
                        ...(isRecord(current) ? current : {}),
                        [childCode]: childValue,
                      }
                    : current,
                ),
              );
            },
            update: (childCode, updater) => {
              updateRows((currentRows) =>
                currentRows.map((current, index) =>
                  index === rowIndex
                    ? {
                        ...(isRecord(current) ? current : {}),
                        [childCode]: updater(isRecord(current) ? current[childCode] : undefined),
                      }
                    : current,
                ),
              );
            },
          };
          return (
            <FieldGroup key={`${node.id}-row-${rowIndex}`}>
              {rowIndex > 0 ? <FieldSeparator /> : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-muted-foreground">
                  Row {rowIndex + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={!enabled || readOnly || rows.length <= minItems}
                  onClick={() =>
                    updateRows((currentRows) =>
                      currentRows.filter((_, index) => index !== rowIndex),
                    )
                  }
                  aria-label={`Remove row ${rowIndex + 1}`}
                >
                  <Trash2Icon aria-hidden="true" />
                  Remove
                </Button>
              </div>
              {node.children.map((child, childIndex) => (
                <Fragment key={child.id || child.pointer}>
                  {needsSectionBreak(child, childIndex) ? <FieldSeparator /> : null}
                  <NodeRenderer
                    node={child}
                    state={state}
                    scope={rowScope}
                    errors={errors}
                    hiddenById={hiddenById}
                    idPrefix={`${idPrefix}-${rowIndex + 1}-${child.id || child.code}`}
                    depth={depth + 1}
                  />
                </Fragment>
              ))}
            </FieldGroup>
          );
        })
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!enabled || readOnly || (maxItems !== undefined && rows.length >= maxItems)}
          onClick={() => updateRows((currentRows) => [...currentRows, {}])}
        >
          <PlusIcon aria-hidden="true" />
          Add row
        </Button>
        {maxItems !== undefined ? (
          <span className="text-xs text-muted-foreground">
            {rows.length} / {maxItems}
          </span>
        ) : null}
      </div>
      <SectionErrors id={`${headingId}-error`} errors={messages} />
    </FieldSet>
  );
}

function NodeRenderer({
  node,
  state,
  scope,
  errors,
  hiddenById,
  idPrefix,
  depth = 0,
}: NodeRendererProps) {
  const ruleId = node.id || node.code;
  if (hiddenById[ruleId] === true || state.visibility[ruleId] === false) {
    return null;
  }

  if (node.kind === "field") {
    return (
      <GeneratedControl
        node={node}
        state={state}
        scope={scope}
        errors={errors}
        idPrefix={idPrefix}
      />
    );
  }

  if (node.kind === "repeater") {
    return (
      <RepeaterControl
        node={node}
        state={state}
        scope={scope}
        errors={errors}
        hiddenById={hiddenById}
        idPrefix={idPrefix}
        depth={depth}
      />
    );
  }

  const enabled = state.enabled[ruleId] !== false;
  const readOnly = state.readOnly[ruleId] === true;
  const required = state.required[ruleId] === true;
  const messages = errorText(errors, node.code);
  return (
    <FieldSet
      aria-disabled={!enabled || readOnly || undefined}
      aria-required={required || undefined}
    >
      <SectionLegend depth={depth}>{node.label}</SectionLegend>
      <SectionDescription description={node.description} />
      {readOnly ? <Badge variant="outline">Read-only section</Badge> : null}
      <FieldGroup>
        {node.children.map((child, childIndex) => (
          <Fragment key={child.id || child.pointer}>
            {needsSectionBreak(child, childIndex) ? <FieldSeparator /> : null}
            <NodeRenderer
              node={child}
              state={state}
              scope={scope}
              errors={errors}
              hiddenById={hiddenById}
              idPrefix={`${idPrefix}-${child.id || child.code}`}
              depth={depth + 1}
            />
          </Fragment>
        ))}
      </FieldGroup>
      <SectionErrors id={domId(idPrefix, ruleId)} errors={messages} />
    </FieldSet>
  );
}

/**
 * TanStack Form owns the React answer values and submission lifecycle while
 * Colander remains the authority for rules, calculations, and validation.
 *
 * User changes stay local; an explicit submit evaluates current rules before
 * response validation. Merging calculated values does not schedule another
 * evaluation.
 *
 * What this file deliberately does not contain is any knowledge of a field type.
 * It walks the core's tree, binds answers, and hands each leaf to the generated
 * control for its type; which control that is, and which properties it receives,
 * are decided by the core's table and this application's component mapping.
 */
export function FormRunner({
  compiled,
  definition,
  initialValues,
  mode,
  transport,
  validation,
  onEvaluation,
  onValidation,
  onError,
  onEvaluating,
  onValidating,
}: FormRunnerProps) {
  const initialAnswers = useMemo(() => ({ ...initialValues }), [initialValues]);
  const [ruleState, setRuleState] = useState<RuleUiState>(() =>
    toRuleUiState(createRuleState(initialAnswers, definition)),
  );
  const [evaluating, setEvaluating] = useState(false);
  const evaluationVersionRef = useRef(0);
  const activeEvaluationVersionRef = useRef<number | null>(null);
  // Keep the form API available to the stable evaluation callback after creation.
  const formRef = useRef<AnyFormApi | null>(null);
  const validationVersionRef = useRef(0);
  const mountedRef = useRef(false);

  const handlers = useRef({
    onEvaluation,
    onValidation,
    onError,
    onEvaluating,
    onValidating,
  });
  useEffect(() => {
    handlers.current = {
      onEvaluation,
      onValidation,
      onError,
      onEvaluating,
      onValidating,
    };
  }, [onEvaluation, onValidation, onError, onEvaluating, onValidating]);

  const runValidation = useCallback(
    async (answers: Record<string, unknown>): Promise<void> => {
      const version = ++validationVersionRef.current;
      handlers.current.onValidating(true);
      try {
        const result = await transport.validateResponse(
          createValidateResponseRequest(compiled, definition, answers, mode),
        );
        if (!mountedRef.current || version !== validationVersionRef.current) {
          return;
        }
        handlers.current.onValidation(result);
        handlers.current.onError(null);
      } catch (error) {
        if (mountedRef.current && version === validationVersionRef.current) {
          handlers.current.onError(toColanderSourceError(error).message);
        }
      } finally {
        if (mountedRef.current && version === validationVersionRef.current) {
          handlers.current.onValidating(false);
        }
      }
    },
    [compiled, definition, mode, transport],
  );

  const evaluateNow = useCallback(
    async (
      values: Record<string, unknown>,
      version: number,
    ): Promise<Record<string, unknown> | null> => {
      if (compiled.rulesSchemaJson === null) {
        return values;
      }
      const form = formRef.current;
      if (form === null) {
        return null;
      }
      activeEvaluationVersionRef.current = version;
      setEvaluating(true);
      handlers.current.onEvaluating(true);
      try {
        const result = await transport.evaluateRules(
          createEvaluateRulesRequest(compiled, definition, values),
        );
        if (!mountedRef.current || version !== evaluationVersionRef.current) {
          return null;
        }
        const currentAnswers = form.state.values.answers;
        const nextState = applyEvaluation(currentAnswers, result, definition);
        // Calculated values are merged into TanStack state without running its
        // change validation or starting another Colander evaluation.
        form.setFieldValue("answers", nextState.values, {
          dontRunListeners: true,
          dontValidate: true,
        });
        setRuleState(toRuleUiState(nextState));
        handlers.current.onEvaluation(result);
        handlers.current.onError(null);
        return nextState.values;
      } catch (error) {
        if (mountedRef.current && version === evaluationVersionRef.current) {
          handlers.current.onError(toColanderSourceError(error).message);
        }
        return null;
      } finally {
        if (activeEvaluationVersionRef.current === version) {
          activeEvaluationVersionRef.current = null;
          if (mountedRef.current) {
            setEvaluating(false);
            handlers.current.onEvaluating(false);
          }
        }
      }
    },
    [compiled, definition, transport],
  );

  const form = useForm({
    defaultValues: { answers: initialAnswers },
    onSubmit: async ({ value }) => {
      const version = ++evaluationVersionRef.current;
      // Invalidate an earlier response before the new evaluation phase.
      ++validationVersionRef.current;
      await runEvaluationThenValidation(
        () => evaluateNow(value.answers, version),
        runValidation,
        () => formRef.current?.getFieldValue("answers") ?? value.answers,
      );
    },
  });
  const formAnswers = useSelector(form.store, (state) => state.values.answers);
  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const handleAnswerChange = useCallback(
    (code: string, value: unknown): void => {
      const currentAnswers = form.getFieldValue("answers");
      const next = { ...currentAnswers, [code]: value };
      evaluationVersionRef.current += 1;
      form.setFieldValue("answers", next, { dontValidate: true });
      handlers.current.onError(null);
    },
    [form],
  );

  const handleAnswerUpdate = useCallback(
    (code: string, updater: (current: unknown) => unknown): void => {
      const currentAnswers = form.getFieldValue("answers");
      const next = { ...currentAnswers, [code]: updater(currentAnswers[code]) };
      evaluationVersionRef.current += 1;
      form.setFieldValue("answers", next, { dontValidate: true });
      handlers.current.onError(null);
    },
    [form],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      evaluationVersionRef.current += 1;
      validationVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const version = ++evaluationVersionRef.current;
    const answers = form.state.values.answers;
    if (compiled.rulesSchemaJson === null) {
      setRuleState(toRuleUiState(createRuleState(answers, definition)));
      return () => {
        evaluationVersionRef.current += 1;
      };
    }
    void evaluateNow(answers, version);
    return () => {
      evaluationVersionRef.current += 1;
    };
  }, [compiled, definition, evaluateNow, form]);

  const rootScope = useMemo<ValueScope>(
    () => ({
      get: (code) => formAnswers[code],
      set: handleAnswerChange,
      update: handleAnswerUpdate,
    }),
    [formAnswers, handleAnswerChange, handleAnswerUpdate],
  );

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string[]> = {};
    if (validation === null) {
      return errors;
    }
    for (const responseError of validation.errors) {
      const resolved = resolveFieldForPath(definition, responseError.path);
      if (resolved === null || resolved.code.length === 0) {
        continue;
      }
      const existing = errors[resolved.code] ?? [];
      existing.push(responseError.message);
      errors[resolved.code] = existing;
    }
    return errors;
  }, [definition, validation]);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit().catch((error) => {
          if (mountedRef.current) {
            handlers.current.onError(toColanderSourceError(error).message);
          }
        });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Form</CardTitle>
          <CardDescription>
            TanStack Form owns answers and submission. Every control below was generated from the
            core&rsquo;s semantic table and this application&rsquo;s component mapping.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {definition.root.map((node) => (
              <NodeRenderer
                key={node.id || node.pointer}
                node={node}
                state={ruleState}
                scope={rootScope}
                errors={fieldErrors}
                hiddenById={definition.hiddenById}
                idPrefix="colander"
              />
            ))}
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          Validate ({mode})
        </Button>
        <span
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {evaluating ? (
            <>
              <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
              Evaluating rules…
            </>
          ) : compiled.rulesSchemaJson === null ? (
            <>No rules document</>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-emerald-500" />
              In sync with the engine
            </>
          )}
        </span>
        {compiled.rulesSchemaJson === null ? (
          <Badge variant="outline">static field metadata</Badge>
        ) : null}
      </div>
    </form>
  );
}
