/**
 * Every type's utilities, looked up by the type rather than imported per family.
 *
 * This module is the reason a consumer writes one import instead of five. A
 * control that needs the step for a `number` field, and the one that needs the
 * answer for a `choice` field, and the one that needs to format a `date`, all
 * ask for what they want here rather than each naming the family module that
 * happens to hold it. The families stay separate modules for a reason — nine
 * types' derivations in one file is what made the example app's `shared.tsx` the
 * place every per-type decision leaked into — and the registry is the index that
 * lets them stay that way.
 *
 * Two properties are bought by the shape below, and the shape is why they hold.
 *
 * **Exhaustiveness is a compile error.** The value is held to a mapped type over
 * `MaterializableFieldType`, which is derived from the core's own table, so a
 * tenth materializable type added to that table is a type this package cannot
 * be built with until its entry is written. It is a build error and not a
 * runtime `undefined` for the control that would have looked the new type up.
 * Note what is *not* here: no hand-written union of the nine type names. Such a
 * union would be a second transcription of the core's vocabulary, and a second
 * transcription is the exact failure this package exists to remove — it would be
 * checked against nothing, and adding a type to the core would leave it stale
 * rather than breaking anything.
 *
 * **The member type is a conditional on the key, not a union of interfaces.**
 * That is what makes `typeUtilities.number.step` and `typeUtilities.integer.step`
 * different functions with different parameter types, and what makes a
 * `NumberConstraints` object unusable where `IntegerConstraints` is expected.
 * A registry typed as `Record<MaterializableFieldType, SomeUnion>` would hand
 * every consumer the union, and the one property worth having here would be the
 * first thing lost.
 *
 * Each entry is the type's *own* object, carrying the type name with it, so a
 * consumer holding one entry knows what it is for without having kept the key
 * that reached it. The members are the exported functions themselves, assembled
 * by reference: writing a rule a second time inside this file would reintroduce
 * the drift at the one place every type is seen at once, and a stale copy here
 * would be the copy a control actually calls.
 *
 * The shape is deliberately ragged. `boolean` has one member and the temporal
 * types have three or five, and a type that declares no property beyond the
 * shell's own has no member a number field has. Padding those with a member
 * that always returns nothing would be a promise the type system cannot keep, and
 * a lookup is not a matrix.
 */

import type { MaterializableFieldType } from "../plan.js";
import type { BooleanUtilities } from "./boolean.js";
import { checkedFrom, unansweredBooleanValue } from "./boolean.js";
import type { ChoiceUtilities } from "./choice.js";
import {
  choiceAnswerFrom,
  choiceControlValue,
  choiceEmptyValue,
  choiceHas,
  unansweredChoiceValue,
} from "./choice.js";
import type { IntegerUtilities, NumberUtilities } from "./numeric.js";
import {
  numberAnswerFrom,
  stepForInteger,
  stepForNumber,
  unansweredNumericValue,
} from "./numeric.js";
import type { DateTimeUtilities, DateUtilities, TimeUtilities } from "./temporal.js";
import {
  MIDNIGHT,
  dateAnswerFrom,
  dateTimeAnswerFrom,
  dateWithTime,
  formatDateAnswer,
  formatDateTimeAnswer,
  formatTimeAnswer,
  parseDateAnswer,
  parseDateTimeAnswer,
  parseTimeAnswer,
  timeAnswerFrom,
  unansweredTemporalValue,
} from "./temporal.js";
import type { TextUtilities } from "./text.js";
import { textAnswerFrom, unansweredTextValue } from "./text.js";

/**
 * The utilities that belong to one materializable type.
 *
 * A conditional rather than a lookup in a record, and both because of how the
 * mapped type below resolves it: a conditional keeps each type's own interface
 * separate, so a key narrows to the members *that* type has and to their own
 * parameter types, while a record of unions would force every consumer to
 * narrow a union before it could call anything.
 *
 * Distributive over `T`, so a type parameter that is not yet resolved behaves as
 * what each type declares — the same rule {@link DeclaredProperties} follows.
 *
 * `text` and `textarea` resolve to the same interface because the core's own
 * decision is that a `textarea` is a `text` field with two declared properties
 * instead of three, and the utilities that leave both alone are one function.
 * They are still two *keys*, and the reason is the key rather than the
 * contents: a consumer iterating the core's types must find an entry for every
 * type the core declares, and it is the lookup that has to be exhaustive, not
 * the set of distinct objects it can hold.
 *
 * The one wiring note: the temporal family's `answerFrom` members are named
 * after the type they serve (`dateAnswerFrom`, `timeAnswerFrom`,
 * `dateTimeAnswerFrom`) because two of the three take different arguments, and
 * the `datetime` half is bound to the shorter member name. The rename is in
 * this file for that reason only; the family modules are not this file's to
 * edit.
 */
export type UtilitiesOf<T extends MaterializableFieldType> = T extends "text" | "textarea"
  ? TextUtilities
  : T extends "number"
    ? NumberUtilities
    : T extends "integer"
      ? IntegerUtilities
      : T extends "boolean"
        ? BooleanUtilities
        : T extends "choice"
          ? ChoiceUtilities
          : T extends "date"
            ? DateUtilities
            : T extends "time"
              ? TimeUtilities
              : T extends "datetime"
                ? DateTimeUtilities
                : never;

/**
 * Every materializable type's utilities, keyed by the type.
 *
 * The mapped type is over `MaterializableFieldType`, so this type has exactly
 * the core's keys and gains one when the core gains a type. That is the whole
 * exhaustiveness argument, and it is why the value below is written to this
 * type rather than to something looser.
 */
export type TypeUtilities = {
  readonly [T in MaterializableFieldType]: { readonly type: T } & UtilitiesOf<T>;
};

/**
 * Every value a host may have to bind to an unanswered field, across all types.
 *
 * The union the per-type `unansweredValue` members resolve to, named so the
 * lookup below has a return type rather than an inline union.
 */
export type UnansweredValue = string | number | boolean | null | readonly string[];

/**
 * The value, held to {@link TypeUtilities} twice over.
 *
 * The literal is `satisfies`-checked and the exported value is annotated with
 * the mapped type, because each of the two catches what the other cannot. The
 * check reports a member that is not the function it claims to be — re-declared
 * here, or wired to a neighbouring family's export — at the line that wrote it.
 * The annotation is what gives the published value its per-type member type:
 * inferred through `satisfies` alone, the nine entries would keep their literal
 * object types, and a consumer would be reading a type that restates this
 * file's contents rather than the core's vocabulary, which is the one thing that
 * may not be restated.
 */
const entries = {
  boolean: {
    checkedFrom,
    type: "boolean",
    unansweredValue: unansweredBooleanValue,
  },
  choice: {
    answerFrom: choiceAnswerFrom,
    controlValue: choiceControlValue,
    emptyValue: choiceEmptyValue,
    has: choiceHas,
    type: "choice",
    unansweredValue: unansweredChoiceValue,
  },
  date: {
    answerFrom: dateAnswerFrom,
    formatAnswer: formatDateAnswer,
    parseAnswer: parseDateAnswer,
    type: "date",
    unansweredValue: unansweredTemporalValue,
  },
  datetime: {
    answerFrom: dateTimeAnswerFrom,
    dateWithTime,
    formatAnswer: formatDateTimeAnswer,
    midnight: MIDNIGHT,
    parseAnswer: parseDateTimeAnswer,
    type: "datetime",
    unansweredValue: unansweredTemporalValue,
  },
  integer: {
    answerFrom: numberAnswerFrom,
    step: stepForInteger,
    type: "integer",
    unansweredValue: unansweredNumericValue,
  },
  number: {
    answerFrom: numberAnswerFrom,
    step: stepForNumber,
    type: "number",
    unansweredValue: unansweredNumericValue,
  },
  text: { answerFrom: textAnswerFrom, type: "text", unansweredValue: unansweredTextValue },
  textarea: {
    answerFrom: textAnswerFrom,
    type: "textarea",
    unansweredValue: unansweredTextValue,
  },
  time: {
    answerFrom: timeAnswerFrom,
    formatAnswer: formatTimeAnswer,
    parseAnswer: parseTimeAnswer,
    type: "time",
    unansweredValue: unansweredTemporalValue,
  },
} satisfies TypeUtilities;

export const typeUtilities: TypeUtilities = entries;

/**
 * The exhaustiveness the mapped type buys, stated so the build proves it rather
 * than so a reviewer has to notice it.
 *
 * There are two things to hold at once, and this alias plus the two checks below
 * hold both. {@link TypeUtilities} is a mapped type over
 * `MaterializableFieldType`, so a tenth materializable type adds a required key
 * and `entries` stops satisfying it. That alone is not the whole rule: a key can
 * be *present* and still be unusable, because {@link UtilitiesOf} is a
 * conditional chain that falls through to `never` for a type it has no branch
 * for — and `never` intersected with `{ readonly type: T }` is `never`, which no
 * object satisfies. So the second check is the one that catches a new type that
 * reached the union without a branch: it walks the keys one at a time, because
 * `UtilitiesOf` distributes and a union would otherwise absorb a `never` and
 * look identical to a complete one.
 *
 * The third is the `satisfies` check itself, which is what catches a member that
 * is not the function it claims to be — and it is why `entries` is written out
 * against {@link TypeUtilities} rather than annotated, so both fire.
 *
 * This block is compiled on every `tsc -b` and is not exported. It lives in a
 * `src/` file and not in the test directory because the package's
 * `tsconfig.json` includes `src/**` while `tsconfig.test.json` is not part of
 * the build, so a type-level assertion under `test/` is enforced by no command
 * in this repository's verification.
 */
type TypeWithNoUtilities<T extends MaterializableFieldType> =
  UtilitiesOf<T> extends never ? T : never;

/** Every materializable type the conditional chain has no branch for. Empty today. */
type UnhandledTypes = {
  [T in MaterializableFieldType]: TypeWithNoUtilities<T>;
}[MaterializableFieldType];

/** Compiles only while every key of the mapped type has an entry. */
const everyTypeHasUtilities: [UnhandledTypes] extends [never] ? true : UnhandledTypes = true;
void everyTypeHasUtilities;

/** The keys of the registry are the core's types and nothing else, in both directions. */
const registryKeysAreTheCoreTypes: [keyof TypeUtilities] extends [MaterializableFieldType]
  ? [MaterializableFieldType] extends [keyof TypeUtilities]
    ? true
    : ["a core type has no entry", MaterializableFieldType]
  : ["a registry key is not a core type", keyof TypeUtilities] = true;
void registryKeysAreTheCoreTypes;

/**
 * The half above that cannot be checked from today's vocabulary: a tenth type
 * does not exist yet, so the build cannot be shown failing on one.
 *
 * This states the mechanism instead, using the real {@link UtilitiesOf} rather
 * than a replica of it. A type the chain has no branch for resolves to `never`
 * — `UtilitiesOf<never>` is the chain's terminal reached with nothing to
 * distribute — and a required key typed `{ readonly type: T } & never` is
 * `never`, which no object satisfies. So a tenth materializable type added to
 * the core's table produces a key here that `entries` cannot fill, and the
 * `satisfies` below the chain is what reports it.
 *
 * The `@ts-expect-error` is the assertion. It is an error on this line today,
 * and the day someone gives the chain a fallback branch — which would silently
 * make every future type resolvable to whatever that branch returns — it stops
 * being an error and the build fails here instead of the exhaustiveness
 * failing quietly.
 */
// @ts-expect-error no object satisfies an entry whose type resolved to `never`
const anUnbranchedTypeHasNoSatisfiableEntry: { readonly type: "currency" } & UtilitiesOf<never> = {
  type: "currency",
};
void anUnbranchedTypeHasNoSatisfiableEntry;

/**
 * The value an unanswered field of one type holds, keyed by the type and by the
 * field property that decides a choice's answer shape.
 *
 * This exists because a registry lookup over an *unresolved* type cannot call a
 * member whose arity differs between entries. `typeUtilities[node.type]` is a
 * union of nine entry types, and a call through a union of call signatures has
 * to satisfy all of them at once: passing a field's `allowMultiple` to the
 * choice entry's `unansweredValue` would be an error against the other eight,
 * which take no argument. The alternatives are both worse — every family's
 * `unansweredValue` would have to grow an ignored parameter, which is a change
 * to seven modules outside this one's business, or a caller would have to branch
 * on `node.type`, which is the one thing `form-runner.tsx` states it does not
 * do.
 *
 * So the dispatch lives here, once, where a lookup by type already lives. It is
 * a lookup and not a branch in the caller: the value is derived from the type
 * and from the one property the descriptor names as deciding the shape.
 *
 * @param type the semantic type of the field
 * @param allowMultiple the field's `allowMultiple`, absent meaning single-select
 * @returns the value a control for that field starts holding
 */
export function unansweredValueFor(
  type: MaterializableFieldType,
  allowMultiple?: boolean,
): UnansweredValue {
  if (type === "choice") {
    return allowMultiple === true ? unansweredChoiceValue(true) : unansweredChoiceValue(false);
  }
  return typeUtilities[type].unansweredValue();
}
