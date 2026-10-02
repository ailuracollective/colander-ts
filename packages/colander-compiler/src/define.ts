/**
 * Declaring a mapping with the components themselves.
 *
 * Writing `text: { module: "...", export: "TextControl" }` by hand repeats the
 * module on every line and the export name twice in the file, once as the
 * declaration and once as the reference. `defineMapping` takes the module once
 * and reads each export name off the function the consumer actually wrote, so the
 * mapping and the components cannot drift apart.
 *
 * It is a plain function with no code generation in it: it returns the same
 * {@link ComponentMapping} the planner would have accepted all along.
 */

import { mappingError } from "./errors.js";
import { isImportedComponent } from "./plan.js";
import type {
  ComponentMapping,
  ComponentSource,
  ImportedComponent,
  MaterializableFieldType,
} from "./plan.js";

/** A component value a consumer wrote in their own module. */
export type NamedComponent = (props: never) => unknown;

/** What `defineMapping` accepts for one type. */
export type MappingEntry = ComponentSource | NamedComponent;

/** The declaration a consumer hands to `defineMapping`. */
export interface MappingDeclaration {
  /** The module the components below are declared in, as an import specifier. */
  readonly module: string;
  /** The component that renders a field's label, description, and errors. */
  readonly shell: MappingEntry;
  /** One entry per materializable type. */
  readonly components: Readonly<Partial<Record<MaterializableFieldType, MappingEntry>>>;
}

/**
 * The export name a value is declared under, or `null` when it has none.
 *
 * A named function declaration is the only form that survives: an arrow function
 * assigned to a const has no name of its own, and its text would have to be
 * reconstructed from the assignment, which is the coupling this avoids.
 */
function exportNameOf(subject: string, value: MappingEntry): string | null {
  if (typeof value === "function") {
    const { name } = value;
    return name.length > 0 ? name : null;
  }
  if (typeof (value as ImportedComponent).export === "string") {
    return (value as ImportedComponent).export;
  }
  if (typeof (value as { jsx?: unknown }).jsx === "string") {
    return null;
  }
  throw mappingError(
    subject,
    "it is neither a component function nor a component reference. Pass a function, or a reference",
  );
}

/**
 * Build a mapping from the components themselves.
 *
 * @param declaration the module they live in, the shell, and one per type
 * @returns a mapping the planner accepts
 */
export function defineMapping(declaration: MappingDeclaration): ComponentMapping {
  if (typeof declaration.module !== "string" || declaration.module.trim().length === 0) {
    throw mappingError(
      "the module the components are declared in",
      "defineMapping needs it, and it was empty",
    );
  }

  const resolve = (
    subject: string,
    entry: MappingEntry | undefined,
  ): ComponentSource | undefined => {
    if (entry === undefined) {
      return undefined;
    }
    if (typeof entry === "object" && entry !== null) {
      // Already a reference or a JSX expression: nothing to derive.
      return entry;
    }
    const name = exportNameOf(subject, entry);
    if (name === null) {
      throw mappingError(
        subject,
        "the component is anonymous, so it has no export name to import. Declare it as a named function, or pass a reference or `jsx` for this type",
      );
    }
    const first = name.charAt(0);
    if (first !== first.toUpperCase() || first.toLowerCase() === first) {
      throw mappingError(
        subject,
        `the component is named \`${name}\`, which cannot be used as a JSX component. Rename it so it starts with an upper-case letter.`,
      );
    }
    return { export: name, module: declaration.module };
  };

  const resolveShell = (entry: MappingEntry | undefined): ImportedComponent => {
    const resolved = resolve("the field shell", entry);
    if (resolved === undefined) {
      throw mappingError(
        "the field shell",
        "defineMapping needs the `shell` that renders a field's label and messages",
      );
    }
    if (isImportedComponent(resolved)) {
      return resolved;
    }
    throw mappingError(
      "the field shell",
      "it is written as JSX; declare the shell as a component and pass the function",
    );
  };

  const shell = resolveShell(declaration.shell);

  const components: Partial<Record<MaterializableFieldType, ComponentSource>> = {};
  for (const [type, entry] of Object.entries(declaration.components)) {
    const resolved = resolve(`the \`${type}\` control`, entry);
    if (resolved !== undefined) {
      components[type as MaterializableFieldType] = resolved;
    }
  }

  return { components, shell };
}
