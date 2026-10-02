/**
 * Component sources: the three ways a consumer can say what a type is made of.
 *
 * All three end up in the same place, which is the only thing the planner cares
 * about: the generated module for one type. They differ in where the code comes
 * from, and that choice is the consumer's.
 *
 * A fourth form — a function that returns JSX, written inline — is deliberately
 * absent. The toolchain rewrites JSX into runtime calls with module-private
 * identifiers, so the source of a live function is not portable into another
 * module. Asking for text, or for a component in a module, is asking for
 * something that survives.
 */

import { SEMANTIC_TYPE_DESCRIPTORS } from "@ailura/colander-client/semantics";
import type {
  FieldPropertyKey,
  MaterializableFieldType,
  SemanticPropertyType,
  SemanticValueKind,
} from "@ailura/colander-client/semantics";

import { mappingError } from "./errors.js";

export type {
  FieldPropertyKey,
  MaterializableFieldType,
  SemanticPropertyType,
  SemanticValueKind,
} from "@ailura/colander-client/semantics";

/** A component the consumer named by the export a module exposes. */
export interface ImportedComponent {
  /** The module specifier to import from, exactly as the consumer wrote it. */
  readonly module: string;
  /** The named export to import. */
  readonly export: string;
}

/**
 * JSX the consumer wrote, copied into the generated module.
 *
 * The text is emitted verbatim and type-checked there, as part of a module the
 * consumer's own compiler already checks, so a typo in it is a build error rather
 * than a broken control. `imports` are the names the JSX may reference: an
 * inline expression cannot close over anything from where it was written, so
 * every component it uses has to be named and imported here.
 */
export interface JsxComponent {
  /** A single JSX expression, not a statement and not a function. */
  readonly jsx: string;
  /**
   * The components the expression may reference, as export name to module.
   *
   * A map, because the export name is already the key the expression uses and
   * repeating the module on every entry says the same thing nine times. Only the
   * names the expression actually mentions are imported.
   */
  readonly imports?: Readonly<Record<string, string>>;
}

/**
 * The slot a written shell uses to place the control it wraps.
 *
 * A shell has to put the control somewhere inside markup the consumer wrote, and
 * an expression cannot be opened around something injected. A written shell
 * therefore declares the point itself, once, as `{control}`: the compiler emits
 * the expression with the generated control in that slot. It is a template slot,
 * not a string substitution — the whole expression is type-checked as part of the
 * generated module, slot included.
 */
export const CONTROL_SLOT = "{control}";

/** Either way of naming a component. */
export type ComponentSource = ImportedComponent | JsxComponent;

/** Whether a source names a component in a module. */
export function isImportedComponent(source: ComponentSource): source is ImportedComponent {
  return typeof (source as ImportedComponent).export === "string";
}

/** Whether a source carries JSX to be emitted. */
export function isJsxComponent(source: ComponentSource): source is JsxComponent {
  return typeof (source as JsxComponent).jsx === "string";
}

/** One semantic property a generated control receives. */
export interface PlannedProperty {
  readonly name: FieldPropertyKey;
  readonly type: SemanticPropertyType;
}

/** Everything one generated control is made of. */
export interface ComponentPlan {
  /** The semantic type this control materialises. */
  readonly type: MaterializableFieldType;
  /** How the consumer says this type is made of. */
  readonly component: ComponentSource;
  /** How the consumer says a field's label, description, and errors are drawn. */
  readonly shell: ComponentSource;
  /** How the type's answer is shaped, which is what types the generated value. */
  readonly value: SemanticValueKind;
  /** The properties this type declares, in the core's order. */
  readonly properties: readonly PlannedProperty[];
}

/** Why one type in the core's vocabulary produced no control. */
export type RejectionKind = "not-materializable" | "unmapped";

/** One type the compiler deliberately did not turn into a control. */
export interface RejectedType {
  readonly type: string;
  readonly kind: RejectionKind;
  /** A sentence a build log can print without the reader needing this package. */
  readonly reason: string;
}

/** The result of planning: what to generate, and what was declined and why. */
export interface ComponentPlanResult {
  /** One plan per mapped, materializable type, in the core's vocabulary order. */
  readonly plans: readonly ComponentPlan[];
  /** Every type that produced no control, with the reason it did not. */
  readonly rejected: readonly RejectedType[];
}

/** A consumer's declaration of what each semantic type is made of. */
export interface ComponentMapping {
  /**
   * The component that renders a field's label, description, and errors.
   *
   * A shell is a component in a module, or written JSX that places the control
   * where it says so: a consumer that keeps the whole field in one place writes
   * the frame and the control together.
   */
  readonly shell: ComponentSource;
  /** The component each materializable type is made of. */
  readonly components: Readonly<Partial<Record<MaterializableFieldType, ComponentSource>>>;
}

/**
 * What a consumer declares about the types it did not map.
 *
 * A partial mapping is legitimate: an application with no time field has no use
 * for a `time` control. What is not legitimate is not knowing that you left one
 * out, so this lets a consumer say which of the two they are.
 */
export interface UnmappedPolicy {
  /**
   * `"report"` keeps a partial mapping legal, which is the default.
   * `"refuse"` turns an unmapped materializable type into a failure.
   */
  readonly onUnmapped?: "report" | "refuse";
}

/**
 * Check one reference, so a broken mapping fails at build time with the name of
 * the offending type rather than emitting a file that will not compile.
 *
 * @param subject the type or role the reference fills
 * @param source the consumer's declaration
 * @returns the declaration, once it is known to be usable
 */
function requireComponentSource(
  subject: string,
  source: ComponentSource | undefined,
): ComponentSource {
  if (source === undefined) {
    throw mappingError(subject, "it is missing");
  }
  if (isImportedComponent(source)) {
    return requireImportedComponent(subject, source);
  }
  if (isJsxComponent(source)) {
    return requireJsxComponent(subject, source);
  }
  throw mappingError(
    subject,
    "it must name a component with `module` and `export`, or carry JSX with `jsx`",
  );
}

function requireImportedComponent(subject: string, source: ImportedComponent): ImportedComponent {
  if (typeof source.module !== "string" || source.module.trim().length === 0) {
    throw mappingError(subject, "`module` must be a non-empty module specifier");
  }
  if (typeof source.export !== "string" || source.export.trim().length === 0) {
    throw mappingError(subject, "`export` must be a non-empty export name");
  }
  return { export: source.export, module: source.module };
}

function requireJsxComponent(subject: string, source: JsxComponent): JsxComponent {
  if (typeof source.jsx !== "string" || source.jsx.trim().length === 0) {
    throw mappingError(subject, "`jsx` must be a non-empty JSX expression");
  }
  const declared: Record<string, string> = { ...source.imports };
  const imports: Record<string, string> = {};
  for (const [name, module] of Object.entries(declared)) {
    if (name.trim().length === 0) {
      throw mappingError(`${subject} jsx`, "an import has an empty name");
    }
    if (typeof module !== "string" || module.trim().length === 0) {
      throw mappingError(
        `${subject} jsx`,
        `the import \`${name}\` names no module, so there is nowhere to import it from`,
      );
    }
    imports[name] = module;
  }
  return Object.keys(imports).length === 0 ? { jsx: source.jsx } : { imports, jsx: source.jsx };
}

/**
 * Refuse a mapping key that names no type in the core's vocabulary.
 *
 * A key the core does not declare is always a mistake, and it is the one mistake
 * with no consequence anywhere else: an unmapped type is reported, so leaving one
 * out is visible, while a mistyped one is dropped on the floor and its field is
 * simply never rendered. The vocabulary is the core's, and this is where a name
 * is checked against it.
 *
 * @param components the components the consumer declared
 * @returns nothing; it throws naming every key it does not recognise
 */
function requireKnownTypeNames(
  components: Readonly<Partial<Record<MaterializableFieldType, ComponentSource>>>,
): void {
  const known = new Set<string>(SEMANTIC_TYPE_DESCRIPTORS.map((descriptor) => descriptor.type));
  // Sorted, so the message names the same keys in the same order however the
  // Mapping happened to be written: a report a reader cannot predict is a
  // Report they cannot match against the object that produced it.
  const unknown = Object.keys(components)
    .filter((type) => !known.has(type))
    .sort();
  if (unknown.length === 0) {
    return;
  }
  throw mappingError(
    unknown.map((type) => `\`${type}\``).join(", "),
    unknown.length === 1
      ? "it names no type in the core vocabulary, so it is almost certainly a typo"
      : "they name no types in the core vocabulary, so they are almost certainly typos",
  );
}

/**
 * Check the shell, which may be a component in a module or written JSX that
 * places the control at {@link CONTROL_SLOT}.
 */
function requireShell(shell: ComponentSource | undefined): ComponentSource {
  if (shell === undefined) {
    throw mappingError("the field shell", "it is missing");
  }
  if (isImportedComponent(shell)) {
    return requireImportedComponent("the field shell", shell);
  }
  if (isJsxComponent(shell)) {
    const source = requireJsxComponent("the field shell", shell);
    if (!source.jsx.includes(CONTROL_SLOT)) {
      throw mappingError(
        "the field shell",
        `the JSX never places \`${CONTROL_SLOT}\`, so the control would be rendered nowhere; give the expression a \`${CONTROL_SLOT}\` where the control belongs`,
      );
    }
    return source;
  }
  throw mappingError(
    "the field shell",
    "it must name a component with `module` and `export`, or carry JSX with `jsx`",
  );
}

function describeSource(source: ComponentSource | undefined): string {
  if (source === undefined) {
    return "no component";
  }
  return isImportedComponent(source) ? `${source.module}#${source.export}` : "inline JSX";
}

/**
 * Turn the core's semantic vocabulary plus a consumer's mapping into one plan
 * per type.
 *
 * The function is pure: it reads the core's table, reads the mapping, and
 * returns plans. It touches no filesystem, knows no bundler, and produces the
 * same result for the same input every time, which is what lets a template and
 * a build-time test share it.
 *
 * A type is declined, never silently dropped: a container has no control to
 * generate, and a materializable type the consumer did not map is reported as
 * unmapped rather than omitted, because a generated tree that quietly lacks a
 * type looks complete and is not.
 *
 * @param mapping the components the consumer chose, and the shell they use
 * @returns the plans and the declined types
 */
export function planComponents(
  mapping: ComponentMapping,
  policy: UnmappedPolicy = {},
): ComponentPlanResult {
  const shell = requireShell(mapping.shell);
  const plans: ComponentPlan[] = [];
  const rejected: RejectedType[] = [];

  requireKnownTypeNames(mapping.components);

  for (const descriptor of SEMANTIC_TYPE_DESCRIPTORS) {
    const mapped = mapping.components[descriptor.type as MaterializableFieldType];

    if (!descriptor.materializable) {
      rejected.push({
        kind: "not-materializable",
        reason:
          mapped === undefined
            ? `\`${descriptor.type}\` holds other fields rather than an answer, so no control is generated for it`
            : `\`${descriptor.type}\` holds other fields rather than an answer, so the component the mapping names for it (${describeSource(mapped)}) is ignored and no control is generated`,
        type: descriptor.type,
      });
      continue;
    }

    if (mapped === undefined) {
      rejected.push({
        kind: "unmapped",
        reason: `the mapping names no component for \`${descriptor.type}\`, so no control is generated for it`,
        type: descriptor.type,
      });
      continue;
    }

    plans.push({
      component: requireComponentSource(`the \`${descriptor.type}\` control`, mapped),
      properties: descriptor.properties.map((property) => ({
        name: property.name,
        type: property.type,
      })),
      shell,
      type: descriptor.type,
      value: descriptor.value,
    });
  }

  if (policy.onUnmapped === "refuse") {
    const unmapped = rejected.filter((entry) => entry.kind === "unmapped");
    if (unmapped.length > 0) {
      throw mappingError(
        unmapped.map((entry) => `\`${entry.type}\``).join(", "),
        `the mapping declares no component for ${unmapped.length === 1 ? "it" : "them"}, and this project refuses an incomplete mapping. Map the type, or drop \`onUnmapped: "refuse"\``,
      );
    }
  }

  return { plans, rejected };
}

/**
 * Prove that a mapping covers every type the core can materialize.
 *
 * A test that calls this fails the moment the core gains a type the consumer has
 * not dealt with, which is the failure a build log cannot be relied on to
 * surface. A consumer that deliberately does not map a type cannot use this; the
 * `onUnmapped` policy is the version of the same idea for a build.
 *
 * @param mapping the components the consumer declared
 * @returns nothing; it throws naming every materializable type left out
 */
export function assertCompleteMapping(mapping: ComponentMapping): void {
  planComponents(mapping, { onUnmapped: "refuse" });
}
