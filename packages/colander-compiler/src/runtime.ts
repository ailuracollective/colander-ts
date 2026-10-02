/**
 * Rendering a field, at runtime.
 *
 * This used to be generated. It stopped being worth generating for a concrete
 * reason: once a consumer's controls are found by convention and each one is
 * bound to its contract in its own file, the generated tree held nothing that was
 * not already somewhere else. The prop types are published
 * ({@link ControlProps}), the binding is the consumer's own `defineControl` call,
 * and the only thing that genuinely needed writing was this: pairing a leaf with
 * the control its type names, and reading the properties that type declares off a
 * compiled field.
 *
 * So the compiler generates the mapping, which cannot be written by hand, and the
 * library provides everything that consumes it.
 */

import type { Field } from "@ailura/colander-client";
import type { FieldOption, MaterializableFieldType } from "@ailura/colander-client/semantics";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";

import type { ControlProps } from "./contracts.js";
import { SHELL_OWNED_PROPERTIES } from "./host.js";
import type { FieldShellProps } from "./host.js";
import type { ComponentSource } from "./plan.js";

/** What a control is: the contract the core declares for the type it materialises. */
export type ColanderControl<T extends MaterializableFieldType> = (
  props: ControlProps<T>,
) => ReactNode;

/**
 * A consumer's controls, keyed by the semantic type they materialise.
 *
 * Keyed by the type rather than by the component's name, because the type is what
 * a leaf carries and what the compiler looks for: `text` is the control for a
 * `text` field, whatever the component happens to be called.
 */
export type ColanderControls = {
  readonly [T in MaterializableFieldType]?: ColanderControl<T>;
};

/** The shape of the generated mapping, which is how a form is bound to a tree. */
export interface ColanderMapping {
  readonly version: number;
  readonly shell: ComponentSource;
  readonly types: Readonly<Record<string, ComponentSource>>;
  readonly declined: readonly { readonly type: string; readonly reason: string }[];
}

/** Everything one control needs in order to render a leaf field. */
export interface ColanderBinding {
  /** The field's semantic type, which selects the control. */
  readonly type: MaterializableFieldType;
  /** A DOM-safe id, already unique within the form. */
  readonly id: string;
  /** The field's answer code, the key in the answers object. */
  readonly code: string;
  /** The compiled field, read for the properties this type declares. */
  readonly field: Field;
  /** The options the core published, empty for every type but a choice. */
  readonly options: readonly FieldOption[];
  /** The current answer. Unknown, because the core's own index holds unknown values. */
  readonly value: unknown;
  /** Report a new answer. */
  readonly onChange: (value: never) => void;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly label: string;
  readonly description?: string | undefined;
  readonly errors: readonly string[];
}

/**
 * The properties a type declares, read off a compiled field.
 *
 * A document is free not to declare a property, and a field is free not to carry
 * one, so this reads what is there and reports the rest as absent rather than
 * inventing a value. The names come from the contract, which comes from the core's
 * table, so a property the core does not declare for this type is never asked for.
 *
 * @param type the semantic type
 * @param field the compiled field
 * @returns the properties, keyed by the core's own names
 */
export function controlPropsFor(
  type: MaterializableFieldType,
  field: Field,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const property of contractFor(type)) {
    props[property.name] = field[property.name];
  }
  return props;
}

/**
 * The shell receives the field's text and the core's messages, never the control:
 * the control is what the shell wraps, and handing it to both would let a field
 * draw its label twice.
 */
/** The shell's half of a field, with its own types rather than a bag of them. */
function shellProps(binding: ColanderBinding): Omit<FieldShellProps, "children"> {
  return {
    id: binding.id,
    label: binding.label,
    required: binding.required,
    // A field with no description says so with the key absent, not with an
    // Explicit `undefined`, so the shell can tell the two apart under
    // `exactOptionalPropertyTypes`.
    ...(binding.description === undefined ? {} : { description: binding.description }),
    errors: binding.errors,
  };
}

function controlProps(binding: ColanderBinding): Record<string, unknown> {
  return {
    code: binding.code,
    disabled: binding.disabled,
    id: binding.id,
    onChange: binding.onChange,
    options: binding.options,
    readOnly: binding.readOnly,
    required: binding.required,
    value: binding.value,
    ...controlPropsFor(binding.type, binding.field),
  };
}

/** The property names one type declares, without the two the shell renders. */
function contractFor(type: MaterializableFieldType): readonly { name: string }[] {
  return SEMANTIC_CONTRACTS.get(type) ?? [];
}

// The table is read once, at module load, from the same core the planner reads.
import { SEMANTIC_TYPE_DESCRIPTORS } from "@ailura/colander-client/semantics";

const SEMANTIC_CONTRACTS = new Map<MaterializableFieldType, readonly { name: string }[]>(
  SEMANTIC_TYPE_DESCRIPTORS.filter((descriptor) => descriptor.materializable).map((descriptor) => [
    descriptor.type,
    descriptor.properties.filter((property) => !SHELL_OWNED_PROPERTIES.includes(property.name)),
  ]),
);

/**
 * Render one leaf field: the control its type names, inside the field's shell.
 *
 * @param controls the consumer's controls, keyed by semantic type
 * @param binding the field, its answer, and what the core concluded about it
 * @returns the rendered field, or `null` when no control covers its type
 */
export function renderColanderField(
  controls: ColanderControls,
  binding: ColanderBinding,
  shell?: (props: Omit<FieldShellProps, "children">, children: ReactNode) => ReactNode,
): ReactNode {
  const Control = controls[binding.type];
  if (Control === undefined) {
    // A type with no control renders nothing, and says so here rather than
    // Rendering an empty box that looks like a field.
    return null;
  }
  // The one assertion in the package. A leaf's type is a value, so the control and
  // The properties its type declares can only be paired here; each control is
  // Checked against its contract where it is written, which is where the mistake
  // Would be made.
  const control = Control as unknown as (props: Record<string, unknown>) => ReactElement | null;
  const element = createElement(control, controlProps(binding));
  return shell === undefined ? element : shell(shellProps(binding), element);
}
