import type { FormDefinition } from "./form-definition.js";
import type { RuleEvaluation } from "./types.js";

type RuleIndexKey =
  | "codeById"
  | "idByCode"
  | "calculatedCodes"
  | "staticReadOnlyCodes"
  | "staticReadOnlyById"
  | "staticRequiredById"
  | "hiddenById"
  | "parentIdById"
  | "descendantIds"
  | "descendantCodes"
  | "fieldIds";

type ReadonlyIndexValue<T> =
  T extends ReadonlySet<infer Value>
    ? ReadonlySet<Value>
    : T extends readonly (infer Value)[]
      ? readonly Value[]
      : T extends Record<string, readonly (infer Value)[]>
        ? Readonly<Record<string, readonly Value[]>>
        : T extends Record<string, infer Value>
          ? Readonly<Record<string, Value>>
          : T;

/** The complete, read-only FormDefinition metadata needed to apply rule state. */
export type RuleIndex = {
  readonly [Key in RuleIndexKey]: ReadonlyIndexValue<FormDefinition[Key]>;
};

export type RuleStateValues<
  TValues extends object,
  TCalculatedValues extends Record<string, unknown>,
> = keyof TCalculatedValues extends never
  ? TValues
  : string extends keyof TCalculatedValues
    ? Record<string, unknown>
    : Omit<TValues, keyof TCalculatedValues> & TCalculatedValues;

export interface RuleState<TValues extends object = Record<string, unknown>> {
  /** Answers remain code-keyed; hidden values are deliberately not removed. */
  readonly values: Readonly<TValues>;
  /** Effective maps are keyed by field id, including inherited container state. */
  readonly visibility: Readonly<Record<string, boolean>>;
  readonly enabled: Readonly<Record<string, boolean>>;
  readonly required: Readonly<Record<string, boolean>>;
  readonly readOnly: Readonly<Record<string, boolean>>;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function emptyEvaluation<
  TCalculatedValues extends Record<string, unknown> = Record<never, never>,
>(): RuleEvaluation<TCalculatedValues> {
  return {
    calculatedValues: {} as TCalculatedValues,
    enabled: {},
    required: {},
    validationErrors: [],
    visibility: {},
  };
}

/**
 * Apply a rule evaluation without mutating the caller's answers or maps.
 *
 * Boolean maps are keyed by field id and calculated values are keyed by field
 * code. Container state is inherited by descendants: a hidden or disabled
 * group/repeater cannot be re-enabled by a child entry. Required is not
 * inherited because a group has no answer of its own.
 */
export function applyEvaluation<
  TValues extends object,
  TCalculatedValues extends Record<string, unknown>,
>(
  values: TValues,
  evaluation: RuleEvaluation<TCalculatedValues>,
  index: RuleIndex,
): RuleState<RuleStateValues<TValues, TCalculatedValues>> {
  const nextValues = { ...values } as Record<string, unknown>;
  for (const [code, value] of Object.entries(evaluation.calculatedValues)) {
    nextValues[code] = value;
  }

  const ids = new Set<string>(index.fieldIds);
  for (const id of Object.keys(index.codeById)) {
    ids.add(id);
  }
  for (const id of Object.values(index.idByCode)) {
    if (id.length > 0) {
      ids.add(id);
    }
  }
  for (const [id, descendants] of Object.entries(index.descendantIds)) {
    ids.add(id);
    descendants.forEach((descendant) => ids.add(descendant));
  }
  for (const [id, codes] of Object.entries(index.descendantCodes)) {
    ids.add(id);
    codes.forEach((code) => {
      const descendantId = index.idByCode[code];
      if (descendantId !== undefined) {
        ids.add(descendantId);
      }
    });
  }
  for (const code of index.calculatedCodes) {
    const id = index.idByCode[code];
    if (id !== undefined) {
      ids.add(id);
    }
  }
  for (const id of [
    ...Object.keys(evaluation.visibility),
    ...Object.keys(evaluation.enabled),
    ...Object.keys(evaluation.required),
  ]) {
    ids.add(id);
  }

  const parentIdById: Record<string, string> = { ...index.parentIdById };
  for (const [containerId, codes] of Object.entries(index.descendantCodes)) {
    for (const code of codes) {
      const descendantId = index.idByCode[code];
      if (
        descendantId !== undefined &&
        descendantId !== containerId &&
        parentIdById[descendantId] === undefined
      ) {
        parentIdById[descendantId] = containerId;
      }
    }
  }

  const visibility: Record<string, boolean> = {};
  const enabled: Record<string, boolean> = {};
  const required: Record<string, boolean> = {};
  const readOnly: Record<string, boolean> = {};
  const baseReadOnly: Record<string, boolean> = {};

  for (const id of ids) {
    const code = index.codeById[id];
    visibility[id] = index.hiddenById[id] !== true;
    enabled[id] = true;
    required[id] = index.staticRequiredById[id] === true;
    baseReadOnly[id] =
      index.staticReadOnlyById[id] === true ||
      (code !== undefined &&
        (index.staticReadOnlyCodes.has(code) || index.calculatedCodes.has(code)));
    readOnly[id] = baseReadOnly[id];
  }

  for (const [id, value] of Object.entries(evaluation.visibility)) {
    visibility[id] = value;
  }
  for (const [id, value] of Object.entries(evaluation.enabled)) {
    enabled[id] = value;
  }
  for (const [id, value] of Object.entries(evaluation.required)) {
    required[id] = value;
  }

  const resolved = new Set<string>();
  const resolving = new Set<string>();
  const resolve = (id: string): void => {
    if (resolved.has(id) || resolving.has(id)) {
      return;
    }
    resolving.add(id);
    const parentId = parentIdById[id];
    if (parentId !== undefined && ids.has(parentId)) {
      resolve(parentId);
    }

    const ownVisibility = hasOwn(evaluation.visibility, id)
      ? (evaluation.visibility[id] ?? true)
      : (visibility[id] ?? true);
    const ownEnabled = hasOwn(evaluation.enabled, id)
      ? (evaluation.enabled[id] ?? true)
      : (enabled[id] ?? true);
    const ownRequired = hasOwn(evaluation.required, id)
      ? (evaluation.required[id] ?? false)
      : (required[id] ?? false);
    const parentVisible = parentId === undefined ? true : (visibility[parentId] ?? true);
    const parentEnabled = parentId === undefined ? true : (enabled[parentId] ?? true);
    const parentReadOnly = parentId === undefined ? false : (readOnly[parentId] ?? false);

    visibility[id] = parentVisible && ownVisibility;
    enabled[id] = parentEnabled && ownEnabled;
    required[id] = ownRequired;
    readOnly[id] = baseReadOnly[id] || parentReadOnly || !enabled[id];
    resolving.delete(id);
    resolved.add(id);
  };

  ids.forEach(resolve);

  return {
    enabled,
    readOnly,
    required,
    values: nextValues as RuleStateValues<TValues, TCalculatedValues>,
    visibility,
  };
}

/** Create state before the first evaluation, using static metadata. */
export function createRuleState<
  TValues extends object,
  TCalculatedValues extends Record<string, unknown> = Record<never, never>,
>(
  values: TValues,
  index: RuleIndex,
  evaluation: RuleEvaluation<TCalculatedValues> | null = null,
): RuleState<RuleStateValues<TValues, TCalculatedValues>> {
  return applyEvaluation(values, evaluation ?? emptyEvaluation<TCalculatedValues>(), index);
}
