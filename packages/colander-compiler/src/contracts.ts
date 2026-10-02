/**
 * The contract a control has to meet, for every type the core can materialize.
 *
 * These types used to exist only inside the generated tree, which made a
 * consumer's own components impossible to type until a generation had run: the
 * file that declared what a `text` control receives was itself a generated file.
 * They are published here instead, derived from the same table the generator
 * reads, so a consumer can type a control before anything is generated, and the
 * two cannot drift.
 *
 * Nothing here is an implementation. A control is the consumer's; this is what
 * one has to accept.
 */

import { SEMANTIC_TYPE_DESCRIPTORS } from "@ailura/colander-client/semantics";
import type {
  FieldPropertyKey,
  SemanticPropertyType,
  SemanticValueKind,
} from "@ailura/colander-client/semantics";
import type { ReactNode } from "react";

import { SHELL_OWNED_PROPERTIES } from "./host.js";
import type {
  ChoiceAnswer,
  ControlChange,
  ControlValue,
  FieldShellProps,
  HostControlProps,
  SemanticControlProps,
} from "./host.js";
import { CONTROL_SLOT } from "./plan.js";
import type { MaterializableFieldType } from "./plan.js";

/**
 * The rest of the host contract, published from here so a consumer has one
 * module to import every type a control or a shell is written against.
 */
export {
  SHELL_OWNED_PROPERTIES,
  type ChoiceAnswer,
  type ChoiceChange,
  type ControlChange,
  type ControlValue,
  type FieldShellProps,
  type HostControlProps,
  type HostFieldProps,
  type SemanticControlProps,
  type SemanticPropertyLike,
} from "./host.js";

/** The props a field shell accepts, for whichever type it wraps. */
export type ShellProps = FieldShellProps;

/** The descriptor the core declares for one materializable type. */
type DescriptorFor<T extends MaterializableFieldType> = Extract<
  (typeof SEMANTIC_TYPE_DESCRIPTORS)[number],
  { readonly type: T }
>;

/**
 * The properties a control for one type receives, without the shell's two.
 *
 * A union rather than a tuple, because a filter over a tuple cannot be proven
 * to still be a tuple while a type parameter is unresolved, and the props this
 * produces are the same either way. The order is not lost where it is read: it
 * is in the runtime {@link ControlContract} the core publishes.
 */
export type ControlProperties<T extends MaterializableFieldType> = Exclude<
  DescriptorFor<T>["properties"][number],
  { readonly name: "title" | "description" }
>;

/** How a type's answer is shaped, which is what types the control's value. */
export type ControlValueKind<T extends MaterializableFieldType> = DescriptorFor<T>["value"];

/**
 * The props a control for a `choice` field that takes several picks.
 *
 * `allowMultiple` is `true` and not `boolean`, and that is the whole point of
 * this variant existing separately. It is a discriminant, and a discriminant
 * has to be a literal for the narrowing in a consumer's component to be real.
 */
export interface MultipleChoiceProps extends HostControlProps<"string-or-string-list", true> {
  readonly allowMultiple: true;
}

/**
 * The props a control for a `choice` field that takes one pick.
 *
 * `allowMultiple` is absent or `false`. Absent counts because a document that
 * does not declare the property is a single-select choice as far as the core is
 * concerned, and because `controlPropsFor` spreads whatever the parsed field
 * carried, which is `boolean | undefined` — so a field with the property unset
 * arrives as an own property holding `undefined`, and a variant that forbade
 * explicit `undefined` would be describing a runtime the binder cannot produce.
 */
export interface SingleChoiceProps extends HostControlProps<"string-or-string-list"> {
  readonly allowMultiple?: false | undefined;
}

/**
 * The props a control for a `choice` field accepts.
 *
 * A union, discriminated on `allowMultiple`, and the reason the union is the
 * narrowest honest expression of this contract. A single
 * `allowMultiple?: boolean` union member would have to hand every control a
 * `value` of `string | null | readonly string[]` and an `onChange` accepting all
 * three — which is a contract that says *report whichever shape you like*,
 * and the core says otherwise in both directions: a single-select rejects a
 * list and a multiple rejects a scalar. Splitting on the literal is what turns
 * a runtime type error the user meets into a compile error the control's author
 * meets.
 */
export type ChoiceControlProps = MultipleChoiceProps | SingleChoiceProps;

/**
 * The props a control for one type accepts.
 *
 * The core's own context, plus the properties that type declares. A control
 * written against this cannot forget one: the core adds a property to a type and
 * this type changes with it, so the component stops compiling until it is dealt
 * with — at the component, rather than in a file nobody wrote.
 *
 * The `choice` branch is the one type whose answer shape is not a property of
 * the type, so it is written out rather than derived. Every other type resolves
 * to the same `HostControlProps & ControlSemanticProps` it always did, and
 * nothing about this changes for them.
 */
export type ControlProps<T extends MaterializableFieldType> = T extends "choice"
  ? ChoiceControlProps
  : HostControlProps<ControlValueKind<T>> & ControlSemanticProps<T>;

/**
 * Only the semantic half of a type's contract.
 *
 * A control takes both halves; a reader off a compiled field produces only this
 * one, because the core's context comes from the form that is binding the field
 * and not from the document.
 */
export type ControlSemanticProps<T extends MaterializableFieldType> = SemanticControlProps<
  ControlProperties<T>
>;

/**
 * What a control for one type must be handed at the point it is declared.
 *
 * The check happens where the control is written, with no generation involved,
 * and it is the same check the generated module performs — one contract, read
 * from one table, by both.
 */
export type ControlComponent<T extends MaterializableFieldType> = (
  props: ControlProps<T>,
) => ReactNode;

/**
 * The runtime half of the contract, for a consumer that reads it.
 *
 * The names are the core's, in the core's order, and nothing here is a default
 * implementation: a consumer uses this to build, to check, or to report.
 */
export interface ControlContract {
  /** The semantic type the contract is for. */
  readonly type: MaterializableFieldType;
  /** How that type's answer is shaped. */
  readonly value: SemanticValueKind;
  /** The wire keys a control receives, in the core's order. */
  readonly properties: readonly {
    readonly name: FieldPropertyKey;
    readonly type: SemanticPropertyType;
  }[];
}

const contracts = new Map<MaterializableFieldType, ControlContract>(
  SEMANTIC_TYPE_DESCRIPTORS.filter((descriptor) => descriptor.materializable).map((descriptor) => [
    descriptor.type,
    {
      properties: descriptor.properties
        .filter((property) => !SHELL_OWNED_PROPERTIES.includes(property.name))
        .map((property) => ({ name: property.name, type: property.type })),
      type: descriptor.type,
      value: descriptor.value,
    },
  ]),
);

/**
 * The contract for one type.
 *
 * @param type the semantic type
 * @returns its contract, or `null` for a type the core does not materialize
 */
export function controlContractFor(type: string): ControlContract | null {
  return contracts.get(type as MaterializableFieldType) ?? null;
}

/** Every contract, in the core's own order. */
export function allControlContracts(): readonly ControlContract[] {
  return SEMANTIC_TYPE_DESCRIPTORS.filter((descriptor) => descriptor.materializable).map(
    (descriptor) =>
      contracts.get(descriptor.type) ?? {
        properties: [],
        type: descriptor.type,
        value: descriptor.value,
      },
  );
}

/**
 * Bind a component to the contract for one type.
 *
 * The result is a component the mapping can name, already known to accept the
 * properties the core declares for that type. Passing a component that does not
 * is a compile error here, naming the type, rather than a failure in a generated
 * file later.
 *
 * @param type the semantic type the component materialises
 * @param component the consumer's component for that type
 * @returns the same component, typed as that type's contract
 */
export function defineControl<T extends MaterializableFieldType>(
  type: T,
  component: ControlComponent<T>,
): ControlComponent<T> {
  if (controlContractFor(type) === null) {
    throw new Error(
      `\`${type}\` is not a type the core materializes, so it has no control contract.`,
    );
  }
  return component;
}

/**
 * The props a consumer's own component receives for a `choice`, and what each
 * half of the answer contract is. This block is compiled on every `tsc -b` and
 * is not exported.
 *
 * It lives in a `src/` file rather than in the test directory on purpose. The
 * package's `tsconfig.json` includes `src/**` and `tsconfig.test.json` is not
 * part of the build, so a type assertion under `test/` is enforced by no
 * command in this repository's verification and would rot unnoticed. Here it is
 * enforced by the build itself, and removing any of the lines below is a
 * compile error — which is the property a type-level test is supposed to have
 * and usually does not.
 *
 * What it states, in the two directions:
 *
 * - **Inbound** — `props.value` is {@link ChoiceAnswer}, a union, in *both*
 *   branches. Deliberately not narrowed by the discriminant. The core guarantees
 *   an inbound answer matches the field's `allowMultiple`, and a document that
 *   disagrees with a stored answer is precisely the case a control must survive
 *   without crashing; narrowing it here would force a control to either cast or
 *   branch on a fact it cannot establish, and either one would be the dishonest
 *   move this change exists to remove. The utilities take the union for the
 *   same reason.
 * - **Outbound** — `props.onChange` accepts exactly the shape this field's
 *   configuration takes, and rejects the other one at compile time. This is the
 *   half that was lying before: it accepted `readonly string[]` for every
 *   choice, which the core rejects for a single-select.
 */
function choiceAnswerShapeProof(props: ChoiceControlProps): void {
  const inbound: ChoiceAnswer = props.value;
  void inbound;
  if (props.allowMultiple) {
    props.onChange(["a", "b"]);
    props.onChange([]);
    // @ts-expect-error a multiple choice takes a list; the core rejects a scalar
    props.onChange("a");
  } else {
    props.onChange("red");
    props.onChange(null);
    // @ts-expect-error a single-select takes a scalar; the core rejects a list
    props.onChange(["red"]);
  }
}
void choiceAnswerShapeProof;

/**
 * The same two directions, read as the published generics rather than through
 * the props. A consumer writing a helper against `ControlChange` gets the
 * configuration-keyed type, and a consumer writing one against the
 * configuration-agnostic `ControlValue` gets the union — which is the statement
 * this whole change is making, and the one the old single type contradicted.
 */
const outboundSingle: ControlChange<"string-or-string-list"> = null;
const outboundMultiple: ControlChange<"string-or-string-list", true> = ["a"];
// @ts-expect-error a single-select's outbound answer is never a list
const outboundSingleAsList: ControlChange<"string-or-string-list"> = ["a"];
// @ts-expect-error a multiple choice's outbound answer is never a scalar
const outboundMultipleAsScalar: ControlChange<"string-or-string-list", true> = "a";
const inboundEither: ControlValue<"string-or-string-list"> = ["a"];
const inboundEitherScalar: ControlValue<"string-or-string-list"> = "a";
const inboundEitherAbsent: ControlValue<"string-or-string-list"> = null;
void [outboundSingle, outboundMultiple, outboundSingleAsList, outboundMultipleAsScalar];
void [inboundEither, inboundEitherScalar, inboundEitherAbsent];

/** What a written shell has to contain, restated for a consumer reading this. */
export const SHELL_CONTROL_SLOT = CONTROL_SLOT;
