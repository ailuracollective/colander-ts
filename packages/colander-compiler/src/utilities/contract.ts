/**
 * The rule every utility in this package obeys, stated where it can be read.
 *
 * The compiler is the only place that already reads the core's table of what
 * each semantic type declares, so it is the only place a per-type decision can
 * be derived rather than guessed. A utility here derives from a declared
 * property or it does not exist; where the core is silent about a type, the
 * utility returns a non-restrictive answer rather than a constraint the core
 * never stated.
 *
 * The types below are what makes that rule enforceable from the type system
 * rather than from review: every family's utilities type their parameters with
 * the alias for the type they serve, so `number` constraints and `integer`
 * constraints are distinct types and neither can be handed the other's fields.
 */

import type { ControlSemanticProps } from "../contracts.js";
import type { MaterializableFieldType } from "../plan.js";

/** The rule every utility in this package obeys: see the feature document. */
export const DERIVATION_RULE = "core-declares" as const;

/**
 * The semantic properties the core's table declares for one type, minus the two
 * the shell renders, as optional props.
 *
 * Derived through the same chain `contracts.ts` already proves out — the
 * descriptor the table holds for the type, the properties left once `title` and
 * `description` are excluded, and {@link SemanticControlProps}'s mapping from a
 * property to its TypeScript type. Reusing that chain is the point: a second,
 * hand-written transcription of the table is a second thing that can drift from
 * the core, which is the failure this whole surface exists to remove.
 *
 * Distributive over `T` so an unresolved `T` behaves like a union of what each
 * type declares, while a concrete `T` resolves to exactly that type's
 * properties. Every property is optional, because a document may declare none
 * of them, and the answer a utility gives for an absent property is a decision
 * the utility makes and not a value it may demand.
 *
 * A type the core declares no property for resolves to `{}`, and a type the
 * shell renders both of whose properties it declares resolves to `{}` too. That
 * is not a missing feature: those types' utilities take no constraints argument
 * at all, and inventing an empty constraints type for them would let a caller
 * pass anything and mean nothing by it.
 */
export type DeclaredProperties<T extends MaterializableFieldType> =
  T extends MaterializableFieldType ? ControlSemanticProps<T> : never;

/**
 * The properties a `number` field may carry: `minimum`, `maximum`, `multipleOf`
 * and `decimalPlaces`.
 *
 * The parameter type of the numeric utilities, and the reason the step utility
 * can exist for this type: `multipleOf` on a `number` is enforced by the core,
 * so a step derived from it constrains nothing the core would not already reject.
 */
export type NumberConstraints = DeclaredProperties<"number">;

/**
 * The properties an `integer` field may carry: `minimum`, `maximum` and
 * `multipleOf`, and not `decimalPlaces`.
 *
 * The absence of `decimalPlaces` is not an oversight and is the reason the
 * integer step is not the number step. The locked contract corpus declares
 * `multipleOf: 0.5` on an `integer` and accepts it, so an integer step derived
 * from `multipleOf` would reject integers the core accepts.
 */
export type IntegerConstraints = DeclaredProperties<"integer">;

/**
 * The properties a `text` field may carry: `minLength`, `maxLength` and
 * `pattern`.
 *
 * The parameter type of the text utilities, which forward these names: they are
 * constraints the core states, and the control's markup decides which element
 * consumes each one.
 */
export type TextConstraints = DeclaredProperties<"text">;

/**
 * The properties a `textarea` field may carry: `minLength` and `maxLength`.
 *
 * A separate alias from {@link TextConstraints} even though the two overlap,
 * because the core keeps `text` and `textarea` as separate types. A utility that
 * wants a `pattern` cannot be handed a textarea.
 */
export type TextareaConstraints = DeclaredProperties<"textarea">;

/**
 * The properties a `choice` field may carry: `allowMultiple`.
 *
 * The single declared property that decides whether a choice's answer is one
 * option or a list of them, and therefore the one the choice utilities derive
 * from. The list of options itself is the core's context on every control, not
 * a property of the type.
 */
export type ChoiceConstraints = DeclaredProperties<"choice">;
